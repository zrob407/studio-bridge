local MAX_NODES = 2000
local MAX_DEPTH = 14

if type(params.tree) ~= "table" then
	error("tree is required")
end

local parent = resolve(params.parent)
local created = 0
local failures = {}
local outline = {}

local function build(node, container, depth)
	if type(node) ~= "table" or type(node.class) ~= "string" then
		error("every node needs a class")
	end

	if depth > MAX_DEPTH then
		error("tree is nested deeper than " .. MAX_DEPTH .. " levels")
	end

	if created >= MAX_NODES then
		error("tree has more than " .. MAX_NODES .. " nodes")
	end

	local ok, instance = pcall(Instance.new, node.class)

	if not ok then
		error("unknown class " .. node.class)
	end

	if node.name then
		instance.Name = node.name
	end

	for name, value in pairs(node.properties or {}) do
		local set, problem = pcall(function()
			instance[name] = decode(value)
		end)

		if not set then
			table.insert(failures, node.class .. " " .. instance.Name .. "." .. name .. ": " .. tostring(problem))
		end
	end

	for name, value in pairs(node.attributes or {}) do
		instance:SetAttribute(name, decode(value))
	end

	for _, tag in ipairs(node.tags or {}) do
		CollectionService:AddTag(instance, tag)
	end

	if node.source and instance:IsA("LuaSourceContainer") then
		instance.Source = node.source
	end

	created += 1

	if depth <= 3 then
		table.insert(outline, string.rep("  ", depth) .. instance.Name .. " [" .. instance.ClassName .. "]")
	end

	for _, child in ipairs(node.children or {}) do
		build(child, instance, depth + 1)
	end

	instance.Parent = container

	return instance
end

if params.replace and params.tree.name then
	local existing = parent:FindFirstChild(params.tree.name)

	while existing do
		existing:Destroy()
		existing = parent:FindFirstChild(params.tree.name)
	end
end

local root = build(params.tree, parent, 0)
local lines = {string.format("built %d instance(s) at %s", created, pathOf(root))}

for _, line in ipairs(outline) do
	table.insert(lines, line)
end

if #failures > 0 then
	table.insert(lines, "property errors:")

	for _, failure in ipairs(failures) do
		table.insert(lines, "  " .. failure)
	end
end

return table.concat(lines, "\n")
