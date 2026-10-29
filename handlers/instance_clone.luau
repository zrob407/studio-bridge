local source = resolve(params.path)
local parent = if params.parent then resolve(params.parent) else source.Parent
local count = params.count or 1
local created = {}

for _ = 1, count do
	local copy = source:Clone()

	if not copy then
		error(pathOf(source) .. " cannot be cloned")
	end

	if params.name then
		copy.Name = params.name
	end

	copy.Parent = parent
	table.insert(created, pathOf(copy))
end

return "cloned:\n" .. table.concat(created, "\n")
