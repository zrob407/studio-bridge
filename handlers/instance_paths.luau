local parent = resolve(params.parent)
local className = params.class or "KeyframeSequence"
local picked = {}

for _, child in ipairs(parent:GetChildren()) do
	if child:IsA(className) then
		table.insert(picked, child)
	end
end

table.sort(picked, function(a, b)
	return a.Name < b.Name
end)

local paths = {}

for _, child in ipairs(picked) do
	table.insert(paths, pathOf(child))
end

return HttpService:JSONEncode(paths)
