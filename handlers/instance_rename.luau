local targets = {}
local seen = {}

local function add(instance)
	if not seen[instance] and (not params.class or instance:IsA(params.class)) and (not params.nameContains or string.find(string.lower(instance.Name), string.lower(params.nameContains), 1, true)) then
		seen[instance] = true
		table.insert(targets, instance)
	end
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

local MAX_RENAMES = 5000

if #targets > MAX_RENAMES then
	error(#targets .. " matched; narrow the selection (limit " .. MAX_RENAMES .. ")")
end

local function escaped(text)
	return (string.gsub(text, "[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0"))
end

local function caseOf(name, mode)
	if mode == "upper" then
		return string.upper(name)
	elseif mode == "lower" then
		return string.lower(name)
	elseif mode == "title" then
		return (string.gsub(string.lower(name), "(%a)([%w_]*)", function(first, rest)
			return string.upper(first) .. rest
		end))
	end

	return name
end

local lines = {}
local changed = 0
local startAt = params.startAt or 1

for index, instance in ipairs(targets) do
	local name = instance.Name

	if params.find then
		local needle = if params.pattern then params.find else escaped(params.find)
		local replacement = if params.pattern then (params.replace or "") else string.gsub(params.replace or "", "%%", "%%%%")

		name = string.gsub(name, needle, replacement)
	end

	if params.case then
		name = caseOf(name, params.case)
	end

	name = (params.prefix or "") .. name .. (params.suffix or "")

	if params.number then
		name = name .. " " .. (startAt + index - 1)
	end

	if name ~= instance.Name then
		changed += 1

		if #lines < 12 then
			table.insert(lines, instance.Name .. " -> " .. name)
		end

		if params.dryRun ~= true then
			instance.Name = name
		end
	end
end

local header = (if params.dryRun then "dry run, nothing renamed. would rename " else "renamed ") .. changed .. " of " .. #targets

if changed > #lines then
	table.insert(lines, (changed - #lines) .. " more")
end

return header .. (if #lines > 0 then "\n" .. table.concat(lines, "\n") else "")
