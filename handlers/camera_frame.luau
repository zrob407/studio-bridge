if type(params.paths) ~= "table" or #params.paths == 0 then
	error("paths is required")
end

local camera = workspace.CurrentCamera
local state = bridgeState()

local minimum
local maximum

local function include(cframe, size)
	for _, sx in ipairs({-0.5, 0.5}) do
		for _, sy in ipairs({-0.5, 0.5}) do
			for _, sz in ipairs({-0.5, 0.5}) do
				local corner = (cframe * CFrame.new(size.X * sx, size.Y * sy, size.Z * sz)).Position

				if not minimum then
					minimum = corner
					maximum = corner
				else
					minimum = Vector3.new(math.min(minimum.X, corner.X), math.min(minimum.Y, corner.Y), math.min(minimum.Z, corner.Z))
					maximum = Vector3.new(math.max(maximum.X, corner.X), math.max(maximum.Y, corner.Y), math.max(maximum.Z, corner.Z))
				end
			end
		end
	end
end

for _, path in ipairs(params.paths) do
	local instance = resolve(path)

	if instance:IsA("Model") then
		local cframe, size = instance:GetBoundingBox()

		include(cframe, size)
	elseif instance:IsA("BasePart") then
		include(instance.CFrame, instance.Size)
	else
		for _, descendant in ipairs(instance:GetDescendants()) do
			if descendant:IsA("BasePart") then
				include(descendant.CFrame, descendant.Size)
			end
		end
	end
end

if not minimum then
	error("nothing to frame: no parts found in the given instances")
end

if not state.savedCamera then
	state.savedCamera = {
		cameraType = camera.CameraType,
		cframe = camera.CFrame,
		focus = camera.Focus,
		fieldOfView = camera.FieldOfView,
	}
end

if type(params.fov) == "number" then
	camera.FieldOfView = math.clamp(params.fov, 1, 120)
end

local center = (minimum + maximum) / 2
local radius = math.max((maximum - minimum).Magnitude / 2, 0.5)
local yaw = math.rad(params.yaw or 35)
local pitch = math.rad(math.clamp(params.pitch or 20, -85, 85))
local margin = params.margin or 1.15
local distance = radius / math.sin(math.rad(camera.FieldOfView) / 2) * margin
local direction = Vector3.new(math.sin(yaw) * math.cos(pitch), math.sin(pitch), math.cos(yaw) * math.cos(pitch))
local position = center + direction * distance

camera.CameraType = Enum.CameraType.Scriptable
camera.CFrame = CFrame.lookAt(position, center)
camera.Focus = CFrame.new(center)

return string.format("framed %d instance(s): center (%.1f, %.1f, %.1f), size (%.1f, %.1f, %.1f), distance %.1f", #params.paths, center.X, center.Y, center.Z, (maximum - minimum).X, (maximum - minimum).Y, (maximum - minimum).Z, distance)
