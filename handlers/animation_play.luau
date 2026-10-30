local RunService = game:GetService("RunService")
local rig = resolve(params.rig)
local state = bridgeState()

state.playbacks = state.playbacks or {}

local playbacks = state.playbacks
local motors = motorsOf(rig)

local function reset()
	for _, motor in pairs(motors) do
		motor.Transform = CFrame.identity
	end
end

local function stopCurrent()
	local current = playbacks[rig]

	if current then
		current.stopped = true
		playbacks[rig] = nil
		reset()

		return true
	end

	return false
end

if params.action == "stop" then
	return if stopCurrent() then "stopped the preview on " .. pathOf(rig) else "nothing was playing on " .. pathOf(rig)
elseif params.action == "status" then
	local current = playbacks[rig]

	if not current then
		return "nothing is playing on " .. pathOf(rig)
	end

	return string.format("playing %s at %.2fs of %.2fs", current.name, current.time, current.length)
elseif params.action ~= "play" then
	error("action must be play, stop or status")
end

local sequence = resolve(params.path)

if not sequence:IsA("KeyframeSequence") then
	error(pathOf(sequence) .. " is not a KeyframeSequence")
end

local keyframes = sortedKeyframesOf(sequence)

if #keyframes == 0 then
	error("the sequence has no keyframes")
end

stopCurrent()

local length = keyframes[#keyframes].Time
local speed = params.speed or 1
local looping = if params.loop ~= nil then params.loop else sequence.Loop
local maxSeconds = params.maxSeconds or 20
local restore = params.restoreAtEnd ~= false
local playback = {stopped = false, name = sequence.Name, length = length, time = 0}
local cache = {}
local startedAt = os.clock()
local connection

playbacks[rig] = playback

local function finish()
	if connection then
		connection:Disconnect()
		connection = nil
	end

	if playbacks[rig] == playback then
		playbacks[rig] = nil

		if restore then
			reset()
		end
	end
end

connection = RunService.Heartbeat:Connect(function()
	if playback.stopped then
		finish()

		return
	end

	local real = os.clock() - startedAt

	if real >= maxSeconds then
		finish()

		return
	end

	local time = real * speed

	if length > 0 and looping then
		time = time % length
	elseif time >= length then
		applyPoses(motors, posesAt(keyframes, length, cache))
		finish()

		return
	end

	playback.time = time
	applyPoses(motors, posesAt(keyframes, time, cache))
end)

return string.format("previewing %s on %s at %gx for up to %gs (stop with action stop; screenshots work while it plays)", sequence.Name, pathOf(rig), speed, maxSeconds)
