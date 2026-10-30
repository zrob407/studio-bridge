local target = resolve(params.path)
local action = params.action

if not target:IsA("Model") and not target:IsA("BasePart") then
	error(pathOf(target) .. " is not a Model or a BasePart")
end

local function currentPivot()
	return target:GetPivot()
end

local function setWorldPivot(frame)
	if target:IsA("Model") and target.PrimaryPart then
		target.PrimaryPart.PivotOffset = target.PrimaryPart.CFrame:ToObjectSpace(frame)
	elseif target:IsA("Model") then
		target.WorldPivot = frame
	else
		target.PivotOffset = target.CFrame:ToObjectSpace(frame)
	end
end

if action == "get" then
	local frame = currentPivot()

	return string.format("%s pivot at %s", pathOf(target), formatVector(frame.Position))
elseif action == "move_to" then
	if not params.position then
		error("position is required")
	end

	local frame = currentPivot()

	target:PivotTo((frame - frame.Position) + toVector3(params.position, "position"))

	return string.format("moved %s so its pivot is at %s", pathOf(target), formatVector(toVector3(params.position, "position")))
end

local low, high = worldBounds(target)

if not low then
	error(pathOf(target) .. " contains no parts")
end

local frame = currentPivot()
local rotation = frame - frame.Position
local middle = (low + high) / 2
local newPosition

if action == "center" then
	newPosition = middle
elseif action == "bottom" then
	newPosition = Vector3.new(middle.X, low.Y, middle.Z)
elseif action == "top" then
	newPosition = Vector3.new(middle.X, high.Y, middle.Z)
elseif action == "set" then
	newPosition = toVector3(params.position, "position")
else
	error("action must be get, center, bottom, top, set or move_to")
end

setWorldPivot(rotation + newPosition)

return string.format("%s pivot now at %s", pathOf(target), formatVector(newPosition))
