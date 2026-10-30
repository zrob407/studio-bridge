local action = params.action
local MAX_TARGETS = 5000
local targets = {}
local seen = {}

local function add(instance)
	if seen[instance] then
		return
	end

	if params.class and not instance:IsA(params.class) then
		return
	end

	if params.nameContains and not string.find(string.lower(instance.Name), string.lower(params.nameContains), 1, true) then
		return
	end

	if params.tag and not CollectionService:HasTag(instance, params.tag) then
		return
	end

	seen[instance] = true
	table.insert(targets, instance)
end

if params.paths then
	for _, path in ipairs(params.paths) do
		add(resolve(path))
	end
else
	local root = resolve(params.root)

	for _, descendant in ipairs(root:GetDescendants()) do
		add(descendant)
	end
end

if #targets == 0 then
	error("nothing matched")
end

if #targets > MAX_TARGETS then
	error(#targets .. " matched; narrow the selection (limit " .. MAX_TARGETS .. ")")
end

local function clamp01(value)
	return math.clamp(value, 0, 1)
end

local function adjusted(current, change)
	local kind = typeof(current)

	if change.add ~= nil then
		local delta = decode(change.add)
		local deltaKind = typeof(delta)

		if kind == "number" and deltaKind == "number" then
			return current + delta
		elseif (kind == "Vector3" and deltaKind == "Vector3") or (kind == "Vector2" and deltaKind == "Vector2") or (kind == "UDim2" and deltaKind == "UDim2") or (kind == "UDim" and deltaKind == "UDim") then
			return current + delta
		elseif kind == "Color3" and deltaKind == "Color3" then
			return Color3.new(clamp01(current.R + delta.R), clamp01(current.G + delta.G), clamp01(current.B + delta.B))
		elseif kind == "CFrame" and deltaKind == "Vector3" then
			return current + delta
		elseif kind == "CFrame" and deltaKind == "CFrame" then
			return current + delta.Position
		end

		error("cannot add a " .. deltaKind .. " to a " .. kind)
	end

	if change.multiply ~= nil then
		local factor = change.multiply

		if type(factor) ~= "number" then
			error("multiply must be a number")
		end

		if kind == "number" or kind == "Vector3" or kind == "Vector2" then
			return current * factor
		elseif kind == "UDim" then
			return UDim.new(current.Scale * factor, current.Offset * factor)
		elseif kind == "UDim2" then
			return UDim2.new(current.X.Scale * factor, current.X.Offset * factor, current.Y.Scale * factor, current.Y.Offset * factor)
		elseif kind == "Color3" then
			return Color3.new(clamp01(current.R * factor), clamp01(current.G * factor), clamp01(current.B * factor))
		end

		error("cannot multiply a " .. kind)
	end

	error("a relative change needs add or multiply")
end

local limit = params.limit or 15
local lines = {}
local changed = 0
local failures = 0

local function remember(line)
	if #lines < limit then
		table.insert(lines, line)
	end
end

if action == "get" then
	if type(params.properties) ~= "table" or #params.properties == 0 then
		error("properties is required, for example [\"Anchored\"]")
	end

	for _, instance in ipairs(targets) do
		local parts = {}

		for _, name in ipairs(params.properties) do
			local ok, value = pcall(function()
				return instance[name]
			end)

			table.insert(parts, name .. "=" .. (if ok then HttpService:JSONEncode(encode(value)) else "n/a"))
		end

		remember(pathOf(instance) .. " " .. table.concat(parts, " "))
	end

	changed = #targets
elseif action == "set" or action == "adjust" then
	if type(params.properties) ~= "table" or next(params.properties) == nil then
		error("properties is required")
	end

	for _, instance in ipairs(targets) do
		for name, value in pairs(params.properties) do
			local ok, problem = pcall(function()
				if action == "set" then
					if params.dryRun ~= true then
						instance[name] = decode(value)
					else
						local _ = instance[name]
					end
				else
					local after = adjusted(instance[name], value)

					if params.dryRun ~= true then
						instance[name] = after
					end
				end
			end)

			if ok then
				changed += 1
			else
				failures += 1
				remember(pathOf(instance) .. "." .. name .. ": " .. tostring(problem))
			end
		end
	end
elseif action == "delete" then
	if params.confirm ~= true and params.dryRun ~= true then
		error("deleting " .. #targets .. " instance(s); pass confirm: true to go ahead, or dryRun: true to preview")
	end

	for _, instance in ipairs(targets) do
		remember(pathOf(instance))

		if params.dryRun ~= true and instance.Parent then
			instance:Destroy()
		end

		changed += 1
	end
else
	error("action must be get, set, adjust or delete")
end

local header = string.format(
	"%s%s %d %s %d matched instance(s)%s",
	if params.dryRun then "dry run, nothing changed. would " else "",
	action,
	changed,
	if action == "set" or action == "adjust" then "value(s) across" else "of",
	#targets,
	if failures > 0 then ", " .. failures .. " failed" else ""
)

return header .. (if #lines > 0 then "\n" .. table.concat(lines, "\n") else "")
