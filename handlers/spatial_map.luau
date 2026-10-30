local mode = params.mode or "map"
local ignore = instancesOf(params.ignore)
local center = toVector3(params.center, "center")

if mode == "scan" then
	local size = toVector3(params.size, "size")
	local overlap = overlapFor(ignore)
	local parts = workspace:GetPartBoundsInBox(CFrame.new(center), size, overlap)
	local classes = {}
	local subjects = {}
	local order = {}
	local anchored = 0
	local loose = 0
	local terrain = false
	local counted = 0
	local low = Vector3.new(math.huge, math.huge, math.huge)
	local high = Vector3.new(-math.huge, -math.huge, -math.huge)

	for _, part in ipairs(parts) do
		if part:IsA("Terrain") then
			terrain = true
		else
			counted += 1
			classes[part.ClassName] = (classes[part.ClassName] or 0) + 1

			if part.Anchored then
				anchored += 1
			else
				loose += 1
			end

			local subject = outermostModel(part)

			if not subjects[subject] then
				subjects[subject] = 0
				table.insert(order, subject)
			end

			subjects[subject] += 1

			local partLow, partHigh = worldBounds(part)

			low = low:Min(partLow)
			high = high:Max(partHigh)
		end
	end

	if counted == 0 then
		return "no parts in that box" .. (if terrain then " (terrain is present)" else "")
	end

	local rows = {}

	for name, amount in pairs(classes) do
		table.insert(rows, {name = name, amount = amount})
	end

	table.sort(rows, function(a, b)
		return a.amount > b.amount
	end)

	local classText = {}

	for index = 1, math.min(#rows, 8) do
		table.insert(classText, rows[index].name .. " " .. rows[index].amount)
	end

	table.sort(order, function(a, b)
		return subjects[a] > subjects[b]
	end)

	local lines = {
		string.format("%d parts in %d object(s), %d anchored, %d unanchored%s", counted, #order, anchored, loose, if terrain then ", terrain present" else ""),
		"classes: " .. table.concat(classText, ", "),
		"extent: " .. formatVector(low) .. " to " .. formatVector(high),
	}

	for index = 1, math.min(#order, params.limit or 10) do
		table.insert(lines, pathOf(order[index]) .. " (" .. subjects[order[index]] .. " parts)")
	end

	if #order > (params.limit or 10) then
		table.insert(lines, (#order - (params.limit or 10)) .. " more objects not shown")
	end

	return table.concat(lines, "\n")
end

if mode ~= "map" then
	error("mode must be map or scan")
end

local step = params.step or 4
local height = params.height or 8
local columns, rows, startX, startZ = gridOf(center, params.size, step)
local filter = groundFilter(ignore, true)
local overlap = overlapFor(ignore)
local fromY = center.Y + (params.rayHeight or 500)
local depth = (params.rayHeight or 500) * 2
local lines = {}

for row = 0, rows - 1 do
	local text = {}

	for column = 0, columns - 1 do
		local x = startX + column * step
		local z = startZ + row * step
		local ground = groundAt(x, z, fromY, depth, filter)
		local symbol

		if not ground then
			symbol = " "
		elseif ground.Material == Enum.Material.Water then
			symbol = "~"
		elseif not ground.Instance:IsA("Terrain") and math.max(ground.Instance.Size.X, ground.Instance.Size.Z) < 256 then
			symbol = "#"
		else
			local frame = CFrame.new(ground.Position + Vector3.new(0, height / 2 + 0.3, 0))
			local things = blockersIn(frame, Vector3.new(step, height - 0.2, step), overlap, false)

			symbol = if #things > 0 then "#" else "."
		end

		table.insert(text, symbol)
	end

	table.insert(lines, table.concat(text))
end

return string.format(
	"%d x %d cells of %g studs, centered %s; top row is the lowest Z\n. open ground  # something stands there  ~ water  (blank) no ground\n%s",
	columns,
	rows,
	step,
	formatVector(center),
	table.concat(lines, "\n")
)
