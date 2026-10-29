local root = resolve(params.path)
local maxDepth = if params.recursive then (params.max_depth or 3) else 1
local limit = params.max_results or 300

local lines = {pathOf(root) .. " [" .. root.ClassName .. "]"}
local count = 0
local truncated = false

local function walk(node, depth)
	for _, child in ipairs(node:GetChildren()) do
		if count >= limit then
			truncated = true
			return
		end

		count += 1

		local label = string.rep("  ", depth) .. child.Name .. " [" .. child.ClassName .. "]"
		local childCount = #child:GetChildren()

		if depth >= maxDepth and childCount > 0 then
			label ..= " (+" .. childCount .. ")"
		end

		table.insert(lines, label)

		if depth < maxDepth then
			walk(child, depth + 1)
		end
	end
end

walk(root, 1)

if truncated then
	table.insert(lines, "[stopped at max_results=" .. limit .. "]")
end

return table.concat(lines, "\n")
