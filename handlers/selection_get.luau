local Selection = game:GetService("Selection")
local selected = Selection:Get()

if #selected == 0 then
	return "nothing is selected"
end

local limit = params.max_results or 100
local lines = {string.format("%d selected", #selected)}

for index, instance in ipairs(selected) do
	if index > limit then
		table.insert(lines, string.format("[showing %d of %d]", limit, #selected))
		break
	end

	table.insert(lines, pathOf(instance) .. "  [" .. instance.ClassName .. "]")
end

return table.concat(lines, "\n")
