local action = params.action
local root = if params.root then resolve(params.root) else game

local function numberOf(value)
	local digits = string.match(tostring(value), "%d+")

	if not digits then
		error("not an asset id: " .. tostring(value))
	end

	return digits
end

local function animations()
	local found = {}

	for _, descendant in ipairs(root:GetDescendants()) do
		if descendant:IsA("Animation") then
			table.insert(found, descendant)
		end
	end

	return found
end

if action == "list" then
	local found = animations()

	if #found == 0 then
		return "no Animation instances under " .. pathOf(root)
	end

	local lines = {}
	local empty = 0

	for _, animation in ipairs(found) do
		if animation.AnimationId == "" then
			empty += 1
		end

		table.insert(lines, pathOf(animation) .. " " .. (if animation.AnimationId == "" then "(no id)" else animation.AnimationId))
	end

	table.insert(lines, #found .. " animations, " .. empty .. " without an id")

	return table.concat(lines, "\n")
elseif action == "set" then
	local animation = resolve(params.path)

	if not animation:IsA("Animation") then
		error(pathOf(animation) .. " is not an Animation")
	end

	animation.AnimationId = "rbxassetid://" .. numberOf(params.id)

	return pathOf(animation) .. " now " .. animation.AnimationId
elseif action == "remap" then
	if type(params.map) ~= "table" or next(params.map) == nil then
		error("map is required, for example {\"123\": \"456\"}")
	end

	local replacements = {}

	for old, new in pairs(params.map) do
		replacements[numberOf(old)] = numberOf(new)
	end

	local lines = {}
	local changed = 0

	for _, animation in ipairs(animations()) do
		local current = string.match(animation.AnimationId, "%d+")
		local replacement = current and replacements[current]

		if replacement then
			changed += 1
			table.insert(lines, pathOf(animation) .. ": " .. current .. " -> " .. replacement)

			if not params.dryRun then
				animation.AnimationId = "rbxassetid://" .. replacement
			end
		end
	end

	table.insert(lines, (if params.dryRun then "would change " else "changed ") .. changed .. " animation(s)")

	return table.concat(lines, "\n")
end

error("action must be list, set or remap")
