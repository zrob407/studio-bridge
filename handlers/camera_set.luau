local camera = workspace.CurrentCamera
local state = bridgeState()

if params.restore then
	local saved = state.savedCamera

	if not saved then
		return "no saved camera view to restore"
	end

	camera.CameraType = saved.cameraType
	camera.CFrame = saved.cframe
	camera.Focus = saved.focus
	camera.FieldOfView = saved.fieldOfView
	state.savedCamera = nil

	return "camera restored"
end

local position = toVector3(params.position, "position")
local target = toVector3(params.target, "target")

if (target - position).Magnitude < 0.01 then
	error("position and target are the same point")
end

if not state.savedCamera then
	state.savedCamera = {
		cameraType = camera.CameraType,
		cframe = camera.CFrame,
		focus = camera.Focus,
		fieldOfView = camera.FieldOfView,
	}
end

camera.CameraType = Enum.CameraType.Scriptable
camera.CFrame = CFrame.lookAt(position, target)
camera.Focus = CFrame.new(target)

if type(params.fov) == "number" then
	camera.FieldOfView = math.clamp(params.fov, 1, 120)
end

return string.format("camera at (%.1f, %.1f, %.1f) looking at (%.1f, %.1f, %.1f), fov %.0f", position.X, position.Y, position.Z, target.X, target.Y, target.Z, camera.FieldOfView)
