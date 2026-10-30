local mode = params.mode
local ignore = instancesOf(params.ignore)
local limit = params.limit or 20

local function partsOf(target)
	local parts = {}

	if target:IsA("BasePart") then
		table.insert(parts, target)
	end

	for _, descendant in ipairs(target:GetDescendants()) do
		if descendant:IsA("BasePart") then
			table.insert(parts, descendant)
		end
	end

	return parts
end

if mode == "placement" then
	local target = if params.path then resolve(params.path) else nil
	local frame
	local size

	if target then
		if target:IsA("Model") then
			frame, size = target:GetBoundingBox()
		elseif target:IsA("BasePart") then
			frame, size = target.CFrame, target.Size
		else
			error(pathOf(target) .. " is not a Model or a BasePart")
		end

		table.insert(ignore, target)
	else
		frame = CFrame.new(toVector3(params.center, "center"))
		size = toVector3(params.size, "size")
	end

	if params.position then
		frame = frame + (toVector3(params.position, "position") - frame.Position)
	end

	local overlap = overlapFor(ignore)
	local touching = blockersIn(frame, size - Vector3.new(0.05, 0.05, 0.05), overlap, true)
	local names = {}
	local terrain = false
	local seen = {}

	for _, part in ipairs(touching) do
		if part:IsA("Terrain") then
			terrain = true
		else
			local subject = outermostModel(part)

			if not seen[subject] then
				seen[subject] = true
				table.insert(names, pathOf(subject))
			end
		end
	end

	local bottom = frame.Position - Vector3.new(0, size.Y / 2, 0)
	local filter = groundFilter(ignore, false)
	local ground = workspace:Raycast(bottom + Vector3.new(0, 1, 0), Vector3.new(0, -(params.groundRange or 200), 0), filter)
	local lines = {string.format("box center %s size %s", formatVector(frame.Position), formatVector(size))}

	if #names > 0 then
		table.insert(lines, #names .. " object(s) overlap it: " .. table.concat(names, ", "))
	else
		table.insert(lines, "no objects overlap it")
	end

	if terrain then
		table.insert(lines, "it overlaps terrain")
	end

	if ground then
		table.insert(lines, string.format("ground %.2f studs below the bottom, slope %.1f deg, %s", bottom.Y - ground.Position.Y, slopeDegrees(ground.Normal), ground.Material.Name))
	else
		table.insert(lines, "no ground below it")
	end

	local verdict = "clear"

	if #names > 0 or terrain then
		verdict = "blocked"
	elseif not ground then
		verdict = "floating over nothing"
	elseif bottom.Y - ground.Position.Y > (params.maxGap or 1) then
		verdict = "floating above the ground"
	elseif slopeDegrees(ground.Normal) > (params.maxSlope or 30) then
		verdict = "on a steep slope"
	end

	table.insert(lines, "verdict: " .. verdict)

	return table.concat(lines, "\n")
elseif mode == "collision" then
	local target = resolve(params.path)
	local own = partsOf(target)

	if #own == 0 then
		error(pathOf(target) .. " contains no parts")
	end

	table.insert(ignore, target)

	local overlap = overlapFor(ignore)
	local touchMap = {}
	local order = {}

	for _, part in ipairs(own) do
		for _, other in ipairs(workspace:GetPartsInPart(part, overlap)) do
			if not other:IsA("Terrain") then
				local subject = outermostModel(other)
				local key = pathOf(subject)

				if not touchMap[key] then
					touchMap[key] = {}
					table.insert(order, key)
				end

				touchMap[key][part.Name] = true
			end
		end
	end

	if #order == 0 then
		return pathOf(target) .. " does not touch anything"
	end

	local lines = {pathOf(target) .. " touches " .. #order .. " object(s):"}

	for index = 1, math.min(#order, limit) do
		local touching = {}

		for name in touchMap[order[index]] do
			table.insert(touching, name)
		end

		table.sort(touching)
		table.insert(lines, order[index] .. " (via " .. table.concat(touching, ", ") .. ")")
	end

	if #order > limit then
		table.insert(lines, (#order - limit) .. " more not shown")
	end

	return table.concat(lines, "\n")
elseif mode == "walkable" then
	local center = toVector3(params.center, "center")
	local step = params.step or 4
	local maxSlope = params.maxSlope or 45
	local radius = params.agentRadius or 1.5
	local height = params.agentHeight or 5
	local columns, rows, startX, startZ = gridOf(center, params.size, step)
	local filter = groundFilter(ignore, true)
	local overlap = overlapFor(ignore)
	local fromY = center.Y + (params.rayHeight or 500)
	local depth = (params.rayHeight or 500) * 2
	local lines = {}
	local counts = {walkable = 0, steep = 0, blocked = 0, water = 0, void = 0}

	for row = 0, rows - 1 do
		local text = {}

		for column = 0, columns - 1 do
			local x = startX + column * step
			local z = startZ + row * step
			local ground = groundAt(x, z, fromY, depth, filter)
			local symbol

			if not ground then
				counts.void += 1
				symbol = " "
			elseif ground.Material == Enum.Material.Water then
				counts.water += 1
				symbol = "~"
			elseif slopeDegrees(ground.Normal) > maxSlope then
				counts.steep += 1
				symbol = "/"
			else
				local frame = CFrame.new(ground.Position + Vector3.new(0, height / 2 + 0.3, 0))

				if #blockersIn(frame, Vector3.new(radius * 2, height - 0.2, radius * 2), overlap, false) > 0 then
					counts.blocked += 1
					symbol = "#"
				else
					counts.walkable += 1
					symbol = "."
				end
			end

			table.insert(text, symbol)
		end

		table.insert(lines, table.concat(text))
	end

	local total = columns * rows
	local header = string.format(
		"%d x %d cells of %g studs: %.1f%% walkable (%d walkable, %d blocked, %d steep, %d water, %d no ground)",
		columns,
		rows,
		step,
		counts.walkable / total * 100,
		counts.walkable,
		counts.blocked,
		counts.steep,
		counts.water,
		counts.void
	)

	if columns <= 120 and rows <= 120 then
		return header .. "\n. walkable  # blocked  / too steep  ~ water  (blank) no ground; top row is the lowest Z\n" .. table.concat(lines, "\n")
	end

	return header
end

error("mode must be placement, collision or walkable")
