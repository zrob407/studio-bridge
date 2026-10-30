local MAX_GRID_CELLS = 10000

local function instancesOf(paths)
	local found = {}

	for _, path in ipairs(paths or {}) do
		table.insert(found, resolve(path))
	end

	return found
end

local function groundFilter(ignore, seeWater)
	local filter = RaycastParams.new()
	filter.FilterType = Enum.RaycastFilterType.Exclude
	filter.FilterDescendantsInstances = ignore
	filter.IgnoreWater = not seeWater

	return filter
end

local function overlapFor(ignore)
	local overlap = OverlapParams.new()
	overlap.FilterType = Enum.RaycastFilterType.Exclude
	overlap.FilterDescendantsInstances = ignore

	return overlap
end

local function groundAt(x, z, fromY, depth, filter)
	return workspace:Raycast(Vector3.new(x, fromY, z), Vector3.new(0, -depth, 0), filter)
end

local function slopeDegrees(normal)
	return math.deg(math.acos(math.clamp(normal.Y, -1, 1)))
end

local function blockersIn(frame, size, overlap, includeTerrain)
	local found = {}

	for _, part in ipairs(workspace:GetPartBoundsInBox(frame, size, overlap)) do
		if includeTerrain or not part:IsA("Terrain") then
			table.insert(found, part)
		end
	end

	return found
end

local function pairOf(value, label)
	if type(value) ~= "table" or type(value[1]) ~= "number" or type(value[2]) ~= "number" then
		error(label .. " must be [width, depth]")
	end

	return value[1], value[2]
end

local function gridOf(center, area, step)
	local width, depth = pairOf(area, "size")

	if step <= 0 then
		error("step must be above 0")
	end

	local columns = math.max(1, math.floor(width / step))
	local rows = math.max(1, math.floor(depth / step))

	if columns * rows > MAX_GRID_CELLS then
		error("that area has " .. columns * rows .. " cells at step " .. step .. " (limit " .. MAX_GRID_CELLS .. "); use a larger step or a smaller area")
	end

	return columns, rows, center.X - width / 2 + step / 2, center.Z - depth / 2 + step / 2
end

local function outermostModel(part)
	local model = nil
	local current = part.Parent

	while current and current ~= workspace and current ~= game do
		if current:IsA("Model") then
			model = current
		end

		current = current.Parent
	end

	return model or part
end
