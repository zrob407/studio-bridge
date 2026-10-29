local instance = resolve(params.path)

local names = {}

if type(params.properties) == "table" and #params.properties > 0 and params.properties[1] ~= "*" then
	names = params.properties
else
	local ok, listed = pcall(function()
		return ReflectionService:GetPropertiesOfClass(instance.ClassName)
	end)

	if ok then
		for _, entry in ipairs(listed) do
			table.insert(names, entry.Name)
		end
	end
end

local properties = {}
local unreadable = {}

for _, name in ipairs(names) do
	if name ~= "Source" or params.include_source then
		local ok, value = pcall(function()
			return instance[name]
		end)

		if ok then
			properties[name] = encode(value)
		else
			table.insert(unreadable, name)
		end
	end
end

local attributes = {}

for name, value in pairs(instance:GetAttributes()) do
	attributes[name] = encode(value)
end

local result = {
	Path = pathOf(instance),
	ClassName = instance.ClassName,
	Children = #instance:GetChildren(),
	Properties = properties,
	Attributes = attributes,
	Tags = CollectionService:GetTags(instance),
}

if #unreadable > 0 then
	result.Unreadable = unreadable
end

return HttpService:JSONEncode(result)
