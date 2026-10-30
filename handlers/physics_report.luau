local root = if params.root then resolve(params.root) else workspace
local sampleSize = params.samples or 8
local voidHeight = workspace.FallenPartsDestroyHeight + 50

local categories = {
	{key = "loose", label = "unanchored and not joined to anything (will fall or drift)"},
	{key = "belowVoid", label = "below the void height"},
	{key = "oversized", label = "larger than 2048 studs in a dimension"},
	{key = "tiny", label = "smaller than 0.05 studs in a dimension"},
	{key = "invisibleSolid", label = "fully transparent but collidable (invisible walls)"},
	{key = "emptyMesh", label = "MeshPart with no MeshId"},
}

local found = {}

for _, category in ipairs(categories) do
	found[category.key] = {}
end

local total = 0
local anchored = 0

for _, descendant in ipairs(root:GetDescendants()) do
	if descendant:IsA("BasePart") and not descendant:IsA("Terrain") then
		total += 1

		if descendant.Anchored then
			anchored += 1
		elseif #descendant:GetJoints() == 0 then
			table.insert(found.loose, descendant)
		end

		if descendant.Position.Y < voidHeight then
			table.insert(found.belowVoid, descendant)
		end

		local size = descendant.Size

		if math.max(size.X, size.Y, size.Z) > 2048 then
			table.insert(found.oversized, descendant)
		end

		if math.min(size.X, size.Y, size.Z) < 0.05 then
			table.insert(found.tiny, descendant)
		end

		if descendant.Transparency >= 1 and descendant.CanCollide then
			table.insert(found.invisibleSolid, descendant)
		end

		if descendant:IsA("MeshPart") and descendant.MeshId == "" then
			table.insert(found.emptyMesh, descendant)
		end
	end
end

local lines = {string.format("%d parts under %s (%d anchored)", total, pathOf(root), anchored)}

for _, category in ipairs(categories) do
	local list = found[category.key]

	if #list > 0 then
		table.insert(lines, #list .. " " .. category.label)

		for index = 1, math.min(#list, sampleSize) do
			table.insert(lines, "  " .. pathOf(list[index]))
		end
	end
end

if #lines == 1 then
	table.insert(lines, "no problems found")
end

return table.concat(lines, "\n")
