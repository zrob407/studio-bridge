local SerializationService = game:GetService("SerializationService")

if type(params.paths) ~= "table" or #params.paths == 0 then
	error("paths is required")
end

local instances = {}
local names = {}

for _, path in ipairs(params.paths) do
	local instance = resolve(path)

	if instance == game or instance.Parent == game then
		error("refusing to export " .. pathOf(instance))
	end

	table.insert(instances, instance)
	table.insert(names, instance.Name)
end

local data = SerializationService:SerializeInstancesAsync(instances)
local fileName = params.file_name or (if #names == 1 then names[1] else "export") .. ".rbxm"

bridge.attachFile(fileName, data)

return string.format("exported %d instance(s) as %s (%d bytes)", #instances, fileName, buffer.len(data))
