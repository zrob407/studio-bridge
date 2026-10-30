local template = resolve(params.template)

if not template:IsA("Model") and not template:IsA("BasePart") then
	error("template must be a Model or a BasePart")
end

local parent = if params.parent then resolve(params.parent) else workspace
local center = toVector3(params.center, "center")
local area = params.size

if type(area) ~= "table" or type(area[1]) ~= "number" or type(area[2]) ~= "number" then
	error("size must be [width, depth]")
end

local count = params.count or 10

if count < 1 or count > 2000 then
	error("count must be between 1 and 2000")
end

local random = Random.new(params.seed or os.time())
local spacing = params.minSpacing or 0
local align = params.align ~= false
local spin = params.randomYaw ~= false
local scaleMin = params.scaleMin or 1
local scaleMax = params.scaleMax or scaleMin
local offset = params.offsetY or 0
local rayHeight = params.rayHeight or 200

local group = Instance.new("Folder")
group.Name = params.groupName or (template.Name .. " Scatter")
group.Parent = parent

local filter = {group, template}

for _, path in ipairs(params.ignore or {}) do
	table.insert(filter, resolve(path))
end

local raycastParams = RaycastParams.new()
raycastParams.FilterType = Enum.RaycastFilterType.Exclude
raycastParams.FilterDescendantsInstances = filter

local placed = {}
local misses = 0
local crowded = 0
local attempts = 0

while #placed < count and attempts < count * 12 do
	attempts += 1

	local x = center.X + (random:NextNumber() - 0.5) * area[1]
	local z = center.Z + (random:NextNumber() - 0.5) * area[2]
	local result = workspace:Raycast(Vector3.new(x, center.Y + rayHeight, z), Vector3.new(0, -rayHeight * 2, 0), raycastParams)

	if not result then
		misses += 1
	else
		local tooClose = false

		if spacing > 0 then
			for _, other in ipairs(placed) do
				local dx = other.X - x
				local dz = other.Z - z

				if dx * dx + dz * dz < spacing * spacing then
					tooClose = true

					break
				end
			end
		end

		if tooClose then
			crowded += 1
		else
			local copy = template:Clone()
			local scale = scaleMin + random:NextNumber() * (scaleMax - scaleMin)
			local rotation = CFrame.identity

			if align then
				local up = result.Normal
				local side = up:Cross(Vector3.zAxis)

				if side.Magnitude < 0.001 then
					side = Vector3.xAxis
				end

				rotation = CFrame.fromMatrix(Vector3.zero, side.Unit, up)
			end

			if spin then
				rotation = rotation * CFrame.Angles(0, random:NextNumber() * math.pi * 2, 0)
			end

			copy.Parent = group

			if copy:IsA("Model") then
				if scale ~= 1 then
					copy:ScaleTo(scale)
				end

				copy:PivotTo(rotation + result.Position)
			else
				copy.Size = copy.Size * scale
				copy.CFrame = rotation + result.Position
			end

			local low = worldBounds(copy)

			if low then
				local lift = result.Position.Y + offset - low.Y

				if copy:IsA("Model") then
					copy:PivotTo(copy:GetPivot() + Vector3.new(0, lift, 0))
				else
					copy.CFrame = copy.CFrame + Vector3.new(0, lift, 0)
				end
			end

			table.insert(placed, Vector3.new(x, result.Position.Y, z))
		end
	end
end

return string.format(
	"placed %d of %d in %s (%d without ground, %d too close)",
	#placed,
	count,
	pathOf(group),
	misses,
	crowded
)
