local TweenService = game:GetService("TweenService")
local MAX_WAIT_SECONDS = 50
local target = resolve(params.path)

if type(params.properties) ~= "table" or next(params.properties) == nil then
	error("properties is required")
end

if params.wait == false and params.restore == true then
	error("restore needs wait to be on")
end

local goal = {}
local original = {}

for name, value in pairs(params.properties) do
	original[name] = target[name]
	goal[name] = decode(value)
end

local duration = params.duration or 1
local repeatCount = params.repeatCount or 0
local reverses = params.reverses == true
local delay = params.delay or 0
local info = TweenInfo.new(
	duration,
	Enum.EasingStyle[params.easingStyle or "Quad"],
	Enum.EasingDirection[params.easingDirection or "Out"],
	repeatCount,
	reverses,
	delay
)

local total = delay + duration * (repeatCount + 1) * (if reverses then 2 else 1)

if params.wait ~= false and total > MAX_WAIT_SECONDS then
	error(string.format("that tween takes %.0fs, more than the %ds one call can wait; shorten it or pass wait: false", total, MAX_WAIT_SECONDS))
end

local tween = TweenService:Create(target, info, goal)
local finished = false

tween.Completed:Connect(function()
	finished = true
end)

tween:Play()

if params.wait == false then
	return "started tween on " .. pathOf(target)
end

local deadline = os.clock() + total + 2

while not finished and os.clock() < deadline do
	task.wait()
end

local restore = if params.restore == nil then true else params.restore

if not finished then
	tween:Cancel()
end

if restore then
	for name, value in pairs(original) do
		target[name] = value
	end
end

return (if finished then "tween finished on " else "tween cancelled on ") .. pathOf(target) .. (if restore then " and the original values were restored" else "")
