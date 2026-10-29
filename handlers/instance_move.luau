if type(params.paths) ~= "table" or #params.paths == 0 then
	error("paths is required")
end

local parent = resolve(params.parent)
local moved = {}

for _, path in ipairs(params.paths) do
	local instance = resolve(path)

	if instance == game or instance.Parent == game then
		error("refusing to move " .. pathOf(instance))
	end

	instance.Parent = parent
	table.insert(moved, pathOf(instance))
end

return "moved to " .. pathOf(parent) .. ":\n" .. table.concat(moved, "\n")
