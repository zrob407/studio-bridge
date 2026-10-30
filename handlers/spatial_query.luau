local mode = params.mode

local function instancesOf(paths)
	local found = {}

	for _, path in ipairs(paths or {}) do
		table.insert(found, resolve(path))
	end

	return found
end

if mode == "bounds" then
	local target = resolve(params.path)
	local low, high = worldBounds(target)

	if not low then
		error(pathOf(target) .. " contains no parts")
	end

	return string.format(
		"%s center %s size %s min %s max %s",
		pathOf(target),
		formatVector((low + high) / 2),
		formatVector(high - low),
		formatVector(low),
		formatVector(high)
	)
end

local overlap = OverlapParams.new()
overlap.FilterType = Enum.RaycastFilterType.Exclude
overlap.FilterDescendantsInstances = instancesOf(params.ignore)

local center = toVector3(params.center, "center")
local found

if mode == "radius" then
	if type(params.radius) ~= "number" then
		error("radius is required")
	end

	found = workspace:GetPartBoundsInRadius(center, params.radius, overlap)
elseif mode == "box" then
	local frame = CFrame.new(center) * CFrame.Angles(0, math.rad(params.yaw or 0), 0)

	found = workspace:GetPartBoundsInBox(frame, toVector3(params.size, "size"), overlap)
else
	error("mode must be radius, box or bounds")
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

local entries = {}
local seen = {}

for _, part in ipairs(found) do
	if not part:IsA("Terrain") or params.includeTerrain == true then
		if not params.class or part:IsA(params.class) then
			local subject = if params.group then outermostModel(part) else part

			if not seen[subject] then
				seen[subject] = true

				local position = if subject:IsA("Model") then subject:GetPivot().Position else subject.Position

				table.insert(entries, {subject = subject, distance = (position - center).Magnitude})
			end
		end
	end
end

table.sort(entries, function(a, b)
	return a.distance < b.distance
end)

if #entries == 0 then
	return "nothing found"
end

local limit = params.limit or 50
local lines = {}

for index = 1, math.min(#entries, limit) do
	local entry = entries[index]

	table.insert(lines, string.format("%s %s distance %.2f", pathOf(entry.subject), entry.subject.ClassName, entry.distance))
end

if #entries > limit then
	table.insert(lines, (#entries - limit) .. " more not shown")
end

return table.concat(lines, "\n")
