local function instancesOf(paths)
	local found = {}

	for _, path in ipairs(paths or {}) do
		table.insert(found, resolve(path))
	end

	return found
end

local raycastParams = RaycastParams.new()
local only = instancesOf(params.only)

if #only > 0 then
	raycastParams.FilterType = Enum.RaycastFilterType.Include
	raycastParams.FilterDescendantsInstances = only
else
	raycastParams.FilterType = Enum.RaycastFilterType.Exclude
	raycastParams.FilterDescendantsInstances = instancesOf(params.ignore)
end

raycastParams.IgnoreWater = params.ignoreWater ~= false
raycastParams.RespectCanCollide = params.respectCanCollide == true

if params.collisionGroup then
	raycastParams.CollisionGroup = params.collisionGroup
end

local rays = params.rays or {params}
local lines = {}

for index, ray in ipairs(rays) do
	local origin = toVector3(ray.origin, "origin")
	local direction

	if ray.target then
		direction = toVector3(ray.target, "target") - origin
	elseif ray.direction then
		direction = toVector3(ray.direction, "direction")
	else
		error("each ray needs a target or a direction")
	end

	local distance = ray.maxDistance or params.maxDistance

	if distance and direction.Magnitude > 0 then
		direction = direction.Unit * distance
	end

	local result = workspace:Raycast(origin, direction, raycastParams)
	local prefix = if #rays > 1 then "[" .. index .. "] " else ""

	if result then
		table.insert(lines, string.format(
			"%shit %s at %s normal %s distance %.2f material %s",
			prefix,
			pathOf(result.Instance),
			formatVector(result.Position),
			formatVector(result.Normal),
			result.Distance,
			result.Material.Name
		))
	else
		table.insert(lines, prefix .. "no hit")
	end
end

return table.concat(lines, "\n")
