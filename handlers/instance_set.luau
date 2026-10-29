local paths = params.paths or {params.path}

if #paths == 0 or paths[1] == nil then
	error("path or paths is required")
end

local applied = 0
local failures = {}

for _, path in ipairs(paths) do
	local instance = resolve(path)

	for name, value in pairs(params.properties or {}) do
		local ok, problem = pcall(function()
			instance[name] = decode(value)
		end)

		if ok then
			applied += 1
		else
			table.insert(failures, pathOf(instance) .. "." .. name .. ": " .. tostring(problem))
		end
	end

	for name, value in pairs(params.attributes or {}) do
		local ok, problem = pcall(function()
			instance:SetAttribute(name, decode(value))
		end)

		if ok then
			applied += 1
		else
			table.insert(failures, pathOf(instance) .. "@" .. name .. ": " .. tostring(problem))
		end
	end

	for _, name in ipairs(params.remove_attributes or {}) do
		instance:SetAttribute(name, nil)
		applied += 1
	end

	for _, tag in ipairs(params.add_tags or {}) do
		CollectionService:AddTag(instance, tag)
		applied += 1
	end

	for _, tag in ipairs(params.remove_tags or {}) do
		CollectionService:RemoveTag(instance, tag)
		applied += 1
	end
end

local message = string.format("applied %d change(s) across %d instance(s)", applied, #paths)

if #failures > 0 then
	message ..= "\nfailed:\n" .. table.concat(failures, "\n")
end

return message
