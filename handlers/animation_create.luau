local rig = resolve(params.rig)
local parent = if params.parent then resolve(params.parent) else game:GetService("ServerStorage")

if type(params.keyframes) ~= "table" or #params.keyframes == 0 then
	error("keyframes is required")
end

local parentOf = {}

for _, descendant in ipairs(rig:GetDescendants()) do
	if descendant:IsA("Motor6D") and descendant.Part0 and descendant.Part1 then
		parentOf[descendant.Part1] = descendant.Part0
	end
end

local function partNamed(name)
	local part = rig:FindFirstChild(name, true)

	if not part or not part:IsA("BasePart") then
		error("the rig has no part named " .. tostring(name))
	end

	return part
end

local function anglesOf(value, label)
	local angles = toVector3(value, label)

	return CFrame.Angles(math.rad(angles.X), math.rad(angles.Y), math.rad(angles.Z))
end

local function enumOf(kind, name, fallback)
	local ok, item = pcall(function()
		return Enum[kind][name or fallback]
	end)

	if not ok then
		error("unknown " .. kind .. ": " .. tostring(name))
	end

	return item
end

local sequence = Instance.new("KeyframeSequence")
sequence.Name = params.name or (rig.Name .. " Animation")
sequence.Loop = params.loop == true
sequence.Priority = enumOf("AnimationPriority", params.priority, "Action")

local poseCount = 0
local markerCount = 0

for _, spec in ipairs(params.keyframes) do
	if type(spec.time) ~= "number" or spec.time < 0 then
		error("every keyframe needs a time of 0 or more")
	end

	local keyframe = Instance.new("Keyframe")
	keyframe.Time = spec.time

	local cache = {}
	local ensure

	ensure = function(part)
		if cache[part] then
			return cache[part]
		end

		local pose = Instance.new("Pose")
		pose.Name = part.Name
		pose.Weight = 0
		pose.CFrame = CFrame.identity

		local above = parentOf[part]

		pose.Parent = if above then ensure(above) else keyframe
		cache[part] = pose

		return pose
	end

	for name, values in pairs(spec.poses or {}) do
		local pose = ensure(partNamed(name))
		local offset = if values.position then toVector3(values.position, name .. " position") else Vector3.zero
		local turn = if values.rotation then anglesOf(values.rotation, name .. " rotation") else CFrame.identity

		pose.CFrame = CFrame.new(offset) * turn
		pose.Weight = values.weight or 1
		pose.EasingStyle = enumOf("PoseEasingStyle", values.easingStyle, "Linear")
		pose.EasingDirection = enumOf("PoseEasingDirection", values.easingDirection, "In")
		poseCount += 1
	end

	for _, marker in ipairs(spec.markers or {}) do
		local made = Instance.new("KeyframeMarker")
		made.Name = marker.name
		made.Value = tostring(marker.value or "")
		made.Parent = keyframe
		markerCount += 1
	end

	keyframe.Parent = sequence
end

sequence.Parent = parent

return string.format("created %s with %d keyframes, %d poses, %d markers", pathOf(sequence), #params.keyframes, poseCount, markerCount)
