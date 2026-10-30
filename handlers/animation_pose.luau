local rig = resolve(params.rig)
local motors = {}

for _, descendant in ipairs(rig:GetDescendants()) do
	if descendant:IsA("Motor6D") and descendant.Part1 then
		motors[descendant.Part1.Name] = descendant
	end
end

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

local keyframes = sequence:GetKeyframes()

if #keyframes == 0 then
	error("the sequence has no keyframes")
end

table.sort(keyframes, function(a, b)
	return a.Time < b.Time
end)

local length = keyframes[#keyframes].Time
local time = math.clamp(params.time or 0, 0, length)
local before = keyframes[1]
local after = keyframes[#keyframes]

for _, keyframe in ipairs(keyframes) do
	if keyframe.Time <= time then
		before = keyframe
	end
end

for index = #keyframes, 1, -1 do
	if keyframes[index].Time >= time then
		after = keyframes[index]
	end
end

local function posesOf(keyframe)
	local found = {}

	for _, descendant in ipairs(keyframe:GetDescendants()) do
		if descendant:IsA("Pose") and descendant.Weight > 0 then
			found[descendant.Name] = descendant.CFrame
		end
	end

	return found
end

for _, motor in pairs(motors) do
	motor.Transform = CFrame.identity
end

local alpha = if after.Time == before.Time then 0 else (time - before.Time) / (after.Time - before.Time)
local fromPoses = posesOf(before)
local toPoses = posesOf(after)
local applied = 0
local missing = {}

for name, goal in pairs(toPoses) do
	local start = fromPoses[name] or CFrame.identity
	local motor = motors[name]

	if motor then
		motor.Transform = start:Lerp(goal, alpha)
		applied += 1
	else
		table.insert(missing, name)
	end
end

for name, start in pairs(fromPoses) do
	if not toPoses[name] and motors[name] then
		motors[name].Transform = start:Lerp(CFrame.identity, alpha)
		applied += 1
	end
end

table.sort(missing)

local message = string.format("posed %d joints on %s at %.3fs of %.3fs", applied, pathOf(rig), time, length)

if #missing > 0 then
	message ..= "\nno joint for: " .. table.concat(missing, ", ")
end

return message
