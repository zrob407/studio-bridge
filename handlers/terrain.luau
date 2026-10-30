local terrain = workspace.Terrain
local action = params.action
local RESOLUTION = 4
local MAX_GENERATE_CELLS = 2000000
local MAX_READ_CELLS = 200000

local function materialOf(name, fallback)
	local wanted = name or fallback
	local ok, item = pcall(function()
		return Enum.Material[wanted]
	end)

	if not ok then
		error("unknown material: " .. tostring(wanted))
	end

	return item
end

local function rotationOf(value)
	if not value then
		return CFrame.identity
	end

	local angles = toVector3(value, "rotation")

	return CFrame.Angles(math.rad(angles.X), math.rad(angles.Y), math.rad(angles.Z))
end

local BIOMES = {
	grassland = {low = "Mud", mid = "Grass", high = "Rock", peak = "Slate", cliff = "Rock", shore = "Sand", under = "Ground"},
	desert = {low = "Sand", mid = "Sand", high = "Sandstone", peak = "Sandstone", cliff = "Sandstone", shore = "Sand", under = "Sandstone"},
	snow = {low = "Ground", mid = "Snow", high = "Snow", peak = "Glacier", cliff = "Rock", shore = "Ground", under = "Rock"},
	volcanic = {low = "Basalt", mid = "Basalt", high = "Slate", peak = "CrackedLava", cliff = "Slate", shore = "Basalt", under = "Basalt"},
	tropical = {low = "Sand", mid = "LeafyGrass", high = "Grass", peak = "Rock", cliff = "Rock", shore = "Sand", under = "Ground"},
}

if action == "fill" then
	local shape = params.shape or "block"
	local material = materialOf(params.material, "Grass")
	local center = toVector3(params.center, "center")
	local frame = CFrame.new(center) * rotationOf(params.rotation)

	if shape == "block" then
		terrain:FillBlock(frame, toVector3(params.size, "size"), material)
	elseif shape == "ball" then
		if type(params.radius) ~= "number" then
			error("radius is required")
		end

		terrain:FillBall(center, params.radius, material)
	elseif shape == "wedge" then
		terrain:FillWedge(frame, toVector3(params.size, "size"), material)
	elseif shape == "cylinder" then
		if type(params.radius) ~= "number" or type(params.height) ~= "number" then
			error("radius and height are required")
		end

		terrain:FillCylinder(frame, params.height, params.radius, material)
	else
		error("shape must be block, ball, cylinder or wedge")
	end

	return "filled " .. shape .. " of " .. material.Name .. " at " .. formatVector(center)
elseif action == "clear" then
	if params.center and params.size then
		terrain:FillBlock(CFrame.new(toVector3(params.center, "center")), toVector3(params.size, "size"), Enum.Material.Air)

		return "cleared the region"
	end

	if params.all ~= true then
		error("give center and size to clear a region, or all: true to clear every voxel")
	end

	terrain:Clear()

	return "cleared all terrain"
elseif action == "read" then
	local center = toVector3(params.center, "center")
	local size = if params.size then toVector3(params.size, "size") else Vector3.new(RESOLUTION, RESOLUTION, RESOLUTION)
	local region = Region3.new(center - size / 2, center + size / 2):ExpandToGrid(RESOLUTION)
	local cells = region.Size / RESOLUTION

	if cells.X * cells.Y * cells.Z > MAX_READ_CELLS then
		error("region is too large to read; use a smaller size")
	end

	local materials, occupancy = terrain:ReadVoxels(region, RESOLUTION)
	local dimensions = materials.Size
	local counts = {}
	local solid = 0
	local total = 0

	for x = 1, dimensions.X do
		for y = 1, dimensions.Y do
			for z = 1, dimensions.Z do
				total += 1

				if occupancy[x][y][z] > 0 then
					solid += 1

					local name = materials[x][y][z].Name
					counts[name] = (counts[name] or 0) + 1
				end
			end
		end
	end

	local rows = {}

	for name, amount in pairs(counts) do
		table.insert(rows, {name = name, amount = amount})
	end

	table.sort(rows, function(a, b)
		return a.amount > b.amount
	end)

	local parts = {}

	for _, row in ipairs(rows) do
		table.insert(parts, row.name .. " " .. row.amount)
	end

	return string.format(
		"region %s to %s: %d of %d cells filled%s",
		formatVector(region.CFrame.Position - region.Size / 2),
		formatVector(region.CFrame.Position + region.Size / 2),
		solid,
		total,
		if #parts > 0 then " (" .. table.concat(parts, ", ") .. ")" else ""
	)
elseif action == "generate" then
	local center = toVector3(params.center, "center")
	local area = params.size

	if type(area) ~= "table" or type(area[1]) ~= "number" or type(area[2]) ~= "number" then
		error("size must be [width, depth]")
	end

	local biome = BIOMES[params.biome or "grassland"]

	if not biome then
		error("unknown biome; use grassland, desert, snow, volcanic or tropical")
	end

	local amplitude = params.amplitude or 40
	local feature = params.scale or 120
	local octaves = math.clamp(params.octaves or 4, 1, 6)
	local seed = params.seed or (os.time() % 100000)
	local waterLevel = params.waterLevel
	local below = params.depth or 16

	local minX = math.floor((center.X - area[1] / 2) / RESOLUTION) * RESOLUTION
	local maxX = math.ceil((center.X + area[1] / 2) / RESOLUTION) * RESOLUTION
	local minZ = math.floor((center.Z - area[2] / 2) / RESOLUTION) * RESOLUTION
	local maxZ = math.ceil((center.Z + area[2] / 2) / RESOLUTION) * RESOLUTION
	local bottomY = math.floor((center.Y - below) / RESOLUTION) * RESOLUTION
	local topY = math.ceil((center.Y + amplitude + 8) / RESOLUTION) * RESOLUTION

	if waterLevel then
		topY = math.max(topY, math.ceil(waterLevel / RESOLUTION) * RESOLUTION)
	end

	local cellsX = (maxX - minX) / RESOLUTION
	local cellsZ = (maxZ - minZ) / RESOLUTION
	local cellsY = (topY - bottomY) / RESOLUTION

	if cellsX * cellsY * cellsZ > MAX_GENERATE_CELLS then
		error("that area is too large (" .. cellsX * cellsY * cellsZ .. " cells, limit " .. MAX_GENERATE_CELLS .. "); generate it in smaller pieces")
	end

	local function shape(x, z)
		local total = 0
		local weight = 1
		local frequency = 1 / feature
		local norm = 0

		for octave = 1, octaves do
			total += math.noise(x * frequency + seed * 0.713 + 0.37, z * frequency + seed * 1.291 + 0.11, octave * 3.7 + 0.5) * weight
			norm += weight
			weight *= 0.5
			frequency *= 2
		end

		return math.clamp(total / norm * 1.6 + 0.5, 0, 1)
	end

	local heights = {}

	for i = 1, cellsX do
		heights[i] = {}

		for k = 1, cellsZ do
			heights[i][k] = center.Y + amplitude * shape(minX + (i - 0.5) * RESOLUTION, minZ + (k - 0.5) * RESOLUTION)
		end
	end

	local function heightAt(i, k)
		local column = heights[math.clamp(i, 1, cellsX)]

		return column[math.clamp(k, 1, cellsZ)]
	end

	local surface = {}

	for i = 1, cellsX do
		surface[i] = {}

		for k = 1, cellsZ do
			local h = heights[i][k]
			local slope = math.max(
				math.abs(h - heightAt(i - 1, k)),
				math.abs(h - heightAt(i + 1, k)),
				math.abs(h - heightAt(i, k - 1)),
				math.abs(h - heightAt(i, k + 1))
			) / RESOLUTION
			local level = if amplitude > 0 then (h - center.Y) / amplitude else 0
			local name

			if slope > 1.1 then
				name = biome.cliff
			elseif waterLevel and h < waterLevel + 3 then
				name = biome.shore
			elseif level < 0.35 then
				name = biome.low
			elseif level < 0.7 then
				name = biome.mid
			elseif level < 0.9 then
				name = biome.high
			else
				name = biome.peak
			end

			surface[i][k] = Enum.Material[name]
		end
	end

	local under = Enum.Material[biome.under]
	local BLOCK = 32
	local written = 0

	for x0 = 1, cellsX, BLOCK do
		for z0 = 1, cellsZ, BLOCK do
			local bx = math.min(BLOCK, cellsX - x0 + 1)
			local bz = math.min(BLOCK, cellsZ - z0 + 1)
			local materials = {}
			local occupancy = {}

			for i = 1, bx do
				materials[i] = {}
				occupancy[i] = {}

				for j = 1, cellsY do
					materials[i][j] = {}
					occupancy[i][j] = {}

					local cellBottom = bottomY + (j - 1) * RESOLUTION

					for k = 1, bz do
						local h = heights[x0 + i - 1][z0 + k - 1]
						local fill = math.clamp((h - cellBottom) / RESOLUTION, 0, 1)

						if fill > 0 then
							occupancy[i][j][k] = fill
							materials[i][j][k] = if h - (cellBottom + RESOLUTION / 2) < 6 then surface[x0 + i - 1][z0 + k - 1] else under
						elseif waterLevel and cellBottom < waterLevel then
							occupancy[i][j][k] = math.clamp((waterLevel - cellBottom) / RESOLUTION, 0, 1)
							materials[i][j][k] = Enum.Material.Water
						else
							occupancy[i][j][k] = 0
							materials[i][j][k] = Enum.Material.Air
						end
					end
				end
			end

			local from = Vector3.new(minX + (x0 - 1) * RESOLUTION, bottomY, minZ + (z0 - 1) * RESOLUTION)

			terrain:WriteVoxels(Region3.new(from, from + Vector3.new(bx * RESOLUTION, cellsY * RESOLUTION, bz * RESOLUTION)), RESOLUTION, materials, occupancy)
			written += bx * bz * cellsY
			task.wait()
		end
	end

	return string.format(
		"generated %s terrain over x %d to %d, z %d to %d, y %d to %d (seed %d, %d cells)",
		params.biome or "grassland",
		minX,
		maxX,
		minZ,
		maxZ,
		bottomY,
		topY,
		seed,
		written
	)
elseif action == "replace_material" then
	local center = toVector3(params.center, "center")
	local size = toVector3(params.size, "size")
	local from = materialOf(params.from, nil)
	local to = materialOf(params.to, nil)
	local region = Region3.new(center - size / 2, center + size / 2):ExpandToGrid(RESOLUTION)

	terrain:ReplaceMaterial(region, RESOLUTION, from, to)

	return "replaced " .. from.Name .. " with " .. to.Name .. " in the region"
elseif action == "smooth" then
	local center = toVector3(params.center, "center")
	local size = toVector3(params.size, "size")
	local passes = math.clamp(params.passes or 1, 1, 5)
	local strength = math.clamp(params.strength or 1, 0, 1)
	local region = Region3.new(center - size / 2, center + size / 2):ExpandToGrid(RESOLUTION)
	local cells = region.Size / RESOLUTION

	if cells.X * cells.Y * cells.Z > MAX_READ_CELLS then
		error("region is too large to smooth; use a smaller size")
	end

	local materials, occupancy = terrain:ReadVoxels(region, RESOLUTION)
	local dimensions = materials.Size

	for _ = 1, passes do
		local nextOccupancy = {}
		local nextMaterials = {}

		for x = 1, dimensions.X do
			nextOccupancy[x] = {}
			nextMaterials[x] = {}

			for y = 1, dimensions.Y do
				nextOccupancy[x][y] = {}
				nextMaterials[x][y] = {}

				for z = 1, dimensions.Z do
					local sum = 0
					local samples = 0
					local votes = {}
					local winner = materials[x][y][z]
					local best = 0

					for dx = -1, 1 do
						for dy = -1, 1 do
							for dz = -1, 1 do
								local nx = x + dx
								local ny = y + dy
								local nz = z + dz

								if nx >= 1 and nx <= dimensions.X and ny >= 1 and ny <= dimensions.Y and nz >= 1 and nz <= dimensions.Z then
									local amount = occupancy[nx][ny][nz]

									sum += amount
									samples += 1

									if amount > 0 then
										local material = materials[nx][ny][nz]

										if material ~= Enum.Material.Air and material ~= Enum.Material.Water then
											votes[material] = (votes[material] or 0) + amount

											if votes[material] > best then
												best = votes[material]
												winner = material
											end
										end
									end
								end
							end
						end
					end

					local current = occupancy[x][y][z]
					local averaged = sum / samples
					local blended = current + (averaged - current) * strength

					nextOccupancy[x][y][z] = blended

					if blended > 0 and materials[x][y][z] == Enum.Material.Air then
						nextMaterials[x][y][z] = winner
					elseif blended <= 0 then
						nextMaterials[x][y][z] = Enum.Material.Air
					else
						nextMaterials[x][y][z] = materials[x][y][z]
					end
				end
			end
		end

		materials = nextMaterials
		occupancy = nextOccupancy
	end

	terrain:WriteVoxels(region, RESOLUTION, materials, occupancy)

	return "smoothed the region with " .. passes .. " pass(es)"
elseif action == "colors" then
	local colors = params.colors

	if type(colors) == "table" and next(colors) ~= nil then
		local changed = 0

		for name, value in pairs(colors) do
			terrain:SetMaterialColor(materialOf(name, nil), decode(value))
			changed += 1
		end

		return "set " .. changed .. " terrain color(s)"
	end

	local names = params.materials or {"Grass", "Sand", "Rock", "Ground", "Mud", "Snow", "Water", "Slate", "Sandstone", "Basalt", "Limestone", "Pavement", "Asphalt", "Cobblestone", "Brick", "Concrete", "CrackedLava", "Glacier", "Ice", "LeafyGrass", "Salt", "WoodPlanks"}
	local lines = {}

	for _, name in ipairs(names) do
		local color = terrain:GetMaterialColor(materialOf(name, nil))

		table.insert(lines, string.format("%s %d, %d, %d", name, math.round(color.R * 255), math.round(color.G * 255), math.round(color.B * 255)))
	end

	return table.concat(lines, "\n")
end

error("action must be fill, clear, read, generate, replace_material, smooth or colors")
