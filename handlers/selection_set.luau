local Selection = game:GetService("Selection")

local instances = {}

for _, path in ipairs(params.paths or {}) do
	table.insert(instances, resolve(path))
end

Selection:Set(instances)

return string.format("selected %d instance(s)", #instances)
