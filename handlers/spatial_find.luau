local mode = params.mode
local ignore = instancesOf(params.ignore)
local limit = params.limit or 10

local function vectorOf(value, label)
	return toVector3(value, label)
end

if mode == "ground" then
	local points = params.points or (if params.x and params.z then {{params.x, params.z}} else nil)

	if type(points) ~= "table" or #points == 0 then
		error("give points as [[x, z], ...] or x and z")
	end

	local fromY = params.fromY or 1000
	local filter = groundFilter(ignore, params.seeWater == true)
	local lines = {}

	for _, point in ipairs(points) do
		local result = groundAt(point[1], point[2], fromY, fromY + (params.depth or 2000), filter)

		if result then
			table.insert(lines, string.format(
				"(%.2f, %.2f): ground y %.2f, slope %.1f deg, %s on %s",
				point[1],
				point[2],
				result.Position.Y,
				slopeDegrees(result.Normal),
				result.Material.Name,
				pathOf(result.Instance)
			))
		else
			table.insert(lines, string.format("(%.2f, %.2f): no ground", point[1], point[2]))
		end
	end

	return table.concat(lines, "\n")
end

local center = vectorOf(params.center, "center")

if mode == "flat" then
	local step = params.step or 4
	local radius = params.radius or step
	local maxSlope = params.maxSlope or 10
	local tolerance = params.tolerance or (radius * math.tan(math.rad(maxSlope)))
	local columns, rows, startX, startZ = gridOf(center, params.size, step)
	local filter = groundFilter(ignore, false)
	local fromY = center.Y + (params.rayHeight or 500)
	local depth = (params.rayHeight or 500) * 2
	local candidates = {}

	for column = 0, columns - 1 do
		for row = 0, rows - 1 do
			local x = startX + column * step
			local z = startZ + row * step
			local middle = groundAt(x, z, fromY, depth, filter)

			if middle and slopeDegrees(middle.Normal) <= maxSlope then
				local low = middle.Position.Y
				local high = middle.Position.Y
				local complete = true

				for _, offset in ipairs({{radius, 0}, {-radius, 0}, {0, radius}, {0, -radius}}) do
					local edge = groundAt(x + offset[1], z + offset[2], fromY, depth, filter)

					if edge then
						low = math.min(low, edge.Position.Y)
						high = math.max(high, edge.Position.Y)
					else
						complete = false
					end
				end

				if complete and high - low <= tolerance then
					table.insert(candidates, {position = middle.Position, spread = high - low, distance = (Vector3.new(x, 0, z) - Vector3.new(center.X, 0, center.Z)).Magnitude})
				end
			end
		end
	end

	table.sort(candidates, function(a, b)
		if math.abs(a.spread - b.spread) > 0.05 then
			return a.spread < b.spread
		end

		return a.distance < b.distance
	end)

	if #candidates == 0 then
		return "no flat spots found; try a larger maxSlope or tolerance"
	end

	local lines = {#candidates .. " flat spots, flattest first:"}

	for index = 1, math.min(#candidates, limit) do
		local entry = candidates[index]

		table.insert(lines, string.format("%s height spread %.2f, %.1f studs from center", formatVector(entry.position), entry.spread, entry.distance))
	end

	return table.concat(lines, "\n")
end

if mode == "space" or mode == "spawn" then
	local isSpawn = mode == "spawn"
	local size = if params.size then vectorOf(params.size, "size") else Vector3.new(4, 6, 4)
	local searchRadius = params.searchRadius or 50
	local step = params.step or math.max(2, math.max(size.X, size.Z) / 2)
	local maxSlope = params.maxSlope or (if isSpawn then 15 else 30)
	local avoidWater = if params.avoidWater ~= nil then params.avoidWater else isSpawn
	local clearance = params.clearance or 0.2
	local supportTolerance = params.supportTolerance or (if isSpawn then 1.5 else math.max(1.5, math.max(size.X, size.Z) / 2 * math.tan(math.rad(maxSlope))))
	local filter = groundFilter(ignore, avoidWater)
	local overlap = overlapFor(ignore)
	local fromY = center.Y + (params.rayHeight or 500)
	local depth = (params.rayHeight or 500) * 2
	local found = {}
	local evaluated = 0

	local function consider(x, z)
		evaluated += 1

		local ground = groundAt(x, z, fromY, depth, filter)

		if not ground or slopeDegrees(ground.Normal) > maxSlope then
			return
		end

		if avoidWater and ground.Material == Enum.Material.Water then
			return
		end

		for _, corner in ipairs({{1, 1}, {1, -1}, {-1, 1}, {-1, -1}}) do
			local support = groundAt(x + corner[1] * size.X * 0.45, z + corner[2] * size.Z * 0.45, ground.Position.Y + supportTolerance + 2, supportTolerance * 2 + 4, filter)

			if not support or math.abs(support.Position.Y - ground.Position.Y) > supportTolerance then
				return
			end
		end

		local frame = CFrame.new(ground.Position + Vector3.new(0, size.Y / 2 + clearance, 0))

		if #blockersIn(frame, size - Vector3.new(0.1, 0.1, 0.1), overlap, false) == 0 then
			table.insert(found, {position = ground.Position, slope = slopeDegrees(ground.Normal), distance = (Vector3.new(x, 0, z) - Vector3.new(center.X, 0, center.Z)).Magnitude})
		end
	end

	consider(center.X, center.Z)

	local ring = step

	while #found < limit and ring <= searchRadius and evaluated < 4000 do
		local samples = math.max(6, math.floor(2 * math.pi * ring / step))

		for index = 0, samples - 1 do
			if #found >= limit or evaluated >= 4000 then
				break
			end

			local angle = index / samples * 2 * math.pi

			consider(center.X + math.cos(angle) * ring, center.Z + math.sin(angle) * ring)
		end

		ring += step
	end

	if #found == 0 then
		return string.format("no free space for a %s box within %g studs (%d spots tried)", formatVector(size), searchRadius, evaluated)
	end

	local lines = {#found .. (if isSpawn then " spawn spot(s)" else " free spot(s)") .. ", nearest first (position is the ground point):"}

	for _, entry in ipairs(found) do
		table.insert(lines, string.format("%s slope %.1f deg, %.1f studs from center", formatVector(entry.position), entry.slope, entry.distance))
	end

	return table.concat(lines, "\n")
end

error("mode must be ground, flat, space or spawn")
