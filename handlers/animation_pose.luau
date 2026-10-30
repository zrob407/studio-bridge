local rig = resolve(params.rig)
local motors = motorsOf(rig)

if params.action == "reset" then
	local reset = 0

	for _, motor in pairs(motors) do
		motor.Transform = CFrame.identity
		reset += 1
	end

	return "reset " .. reset .. " joints on " .. pathOf(rig)
end

if params.action ~= "pose" then
	error("action must be pose or reset")
end

local sequence = resolve(params.path)

if not sequence:IsA("KeyframeSequence") then
	error(pathOf(sequence) .. " is not a KeyframeSequence")
end

local keyframes = sortedKeyframesOf(sequence)

if #keyframes == 0 then
	error("the sequence has no keyframes")
end

local length = keyframes[#keyframes].Time
local time = math.clamp(params.time or 0, 0, length)
local blended = posesAt(keyframes, time)
local applied = 0
local missing = {}

for name in pairs(blended) do
	if not motors[name] then
		table.insert(missing, name)
	else
		applied += 1
	end
end

applyPoses(motors, blended)
table.sort(missing)

local message = string.format("posed %d joints on %s at %.3fs of %.3fs", applied, pathOf(rig), time, length)

if #missing > 0 then
	message ..= "\nno joint for: " .. table.concat(missing, ", ")
end

return message
