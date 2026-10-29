if type(params.paths) ~= "table" or #params.paths == 0 then
	error("paths is required")
end

local removed = {}

for _, path in ipairs(params.paths) do
	local instance = resolve(path)

	if instance == game or instance.Parent == game then
		error("refusing to delete " .. pathOf(instance))
	end

	table.insert(removed, pathOf(instance))
	instance:Destroy()
end

return "deleted:\n" .. table.concat(removed, "\n")
