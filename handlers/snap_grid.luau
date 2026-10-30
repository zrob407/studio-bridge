local targets = {}

if params.paths then
	for _, path in ipairs(params.paths) do
		table.insert(targets, resolve(path))
	end
elseif params.path then
	table.insert(targets, resolve(params.path))
end

if #targets == 0 then
	error("path or paths is required")
end

local grid = params.grid or 1
local cell

if type(grid) == "number" then
	cell = Vector3.new(grid, grid, grid)
else
	cell = toVector3(grid, "grid")
end

local axes = params.axes or {"x", "y", "z"}
local enabled = {x = false, y = false, z = false}

for _, axis in ipairs(axes) do
	enabled[string.lower(axis)] = true
end

local rotationStep = params.rotation

local function snapNumber(value, size)
	if size <= 0 then
		return value
	end

	return math.round(value / size) * size
end

local lines = {}

for _, target in ipairs(targets) do
	local frame

	if target:IsA("Model") then
		frame = target:GetPivot()
	elseif target:IsA("BasePart") then
		frame = target.CFrame
	else
		error(pathOf(target) .. " is not a Model or a BasePart")
	end

	local position = frame.Position
	local snapped = Vector3.new(
		if enabled.x then snapNumber(position.X, cell.X) else position.X,
		if enabled.y then snapNumber(position.Y, cell.Y) else position.Y,
		if enabled.z then snapNumber(position.Z, cell.Z) else position.Z
	)
	local rotation = frame - frame.Position

	if rotationStep and rotationStep > 0 then
		local rx, ry, rz = frame:ToEulerAnglesYXZ()
		local step = math.rad(rotationStep)

		rotation = CFrame.fromEulerAnglesYXZ(snapNumber(rx, step), snapNumber(ry, step), snapNumber(rz, step))
	end

	local after = rotation + snapped

	if params.dryRun ~= true then
		if target:IsA("Model") then
			target:PivotTo(after)
		else
			target.CFrame = after
		end
	end

	table.insert(lines, string.format("%s %s -> %s", pathOf(target), formatVector(position), formatVector(snapped)))
end

return (if params.dryRun then "dry run, nothing moved\n" else "") .. table.concat(lines, "\n")
