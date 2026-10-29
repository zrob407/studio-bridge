if type(params.class) ~= "string" then
	error("class is required")
end

local parent = resolve(params.parent)
local count = params.count or 1
local created = {}
local failures = {}

for index = 1, count do
	local instance = Instance.new(params.class)

	if params.name then
		instance.Name = params.name
	end

	for name, value in pairs(params.properties or {}) do
		local ok, problem = pcall(function()
			instance[name] = decode(value)
		end)

		if not ok then
			table.insert(failures, name .. ": " .. tostring(problem))
		end
	end

	for name, value in pairs(params.attributes or {}) do
		instance:SetAttribute(name, decode(value))
	end

	for _, tag in ipairs(params.tags or {}) do
		CollectionService:AddTag(instance, tag)
	end

	if params.source and instance:IsA("LuaSourceContainer") then
		instance.Source = params.source
	end

	instance.Parent = parent
	table.insert(created, pathOf(instance))
end

local message = "created:\n" .. table.concat(created, "\n")

if #failures > 0 then
	message ..= "\nproperty errors:\n" .. table.concat(failures, "\n")
end

return message
