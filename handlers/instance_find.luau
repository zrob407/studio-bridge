local root = if params.root then resolve(params.root) else game
local limit = params.max_results or 100

local namePattern

if params.name then
	local escaped = string.gsub(string.lower(params.name), "[%^%$%(%)%%%.%[%]%+%-]", "%%%0")
	local hasWildcard = string.find(escaped, "[%*%?]") ~= nil

	escaped = string.gsub(escaped, "%*", ".*")
	escaped = string.gsub(escaped, "%?", ".")

	if hasWildcard or params.exact then
		namePattern = "^" .. escaped .. "$"
	else
		namePattern = escaped
	end
end

local candidates

if params.tag then
	candidates = {}

	for _, tagged in ipairs(CollectionService:GetTagged(params.tag)) do
		if tagged == root or tagged:IsDescendantOf(root) then
			table.insert(candidates, tagged)
		end
	end
else
	candidates = root:GetDescendants()
end

local propertyValue

if params.property then
	propertyValue = decode(params.value)
end

local out = {}
local total = 0

for _, instance in ipairs(candidates) do
	local keep = true

	if namePattern and not string.find(string.lower(instance.Name), namePattern) then
		keep = false
	end

	if keep and params.class then
		if params.exact_class then
			keep = instance.ClassName == params.class
		else
			keep = instance:IsA(params.class)
		end
	end

	if keep and params.property then
		local ok, current = pcall(function()
			return instance[params.property]
		end)

		keep = ok and current == propertyValue
	end

	if keep then
		total += 1

		if total <= limit then
			table.insert(out, pathOf(instance) .. "  [" .. instance.ClassName .. "]")
		end
	end
end

if total == 0 then
	return "no matches"
end

if total > limit then
	table.insert(out, string.format("[%d matches, showing %d]", total, limit))
end

return table.concat(out, "\n")
