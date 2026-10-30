local UserInputService = game:GetService("UserInputService")
local MAX_SECONDS = 50

if type(params.steps) ~= "table" or #params.steps == 0 then
	error("steps is required, for example [{\"type\": \"click\", \"x\": 400, \"y\": 300}]")
end

local viewport = workspace.CurrentCamera.ViewportSize
local input = UserInputService:CreateVirtualInput()
local BUTTONS = {
	left = Enum.UserInputType.MouseButton1,
	right = Enum.UserInputType.MouseButton2,
	middle = Enum.UserInputType.MouseButton3,
}

local function pointOf(step, label)
	if type(step.x) ~= "number" or type(step.y) ~= "number" then
		error(label .. " needs x and y")
	end

	local point = Vector2.new(step.x, step.y)

	if point.X < 0 or point.Y < 0 or point.X >= viewport.X or point.Y >= viewport.Y then
		error(string.format("(%d, %d) is outside the %dx%d viewport", point.X, point.Y, viewport.X, viewport.Y))
	end

	return point
end

local function buttonOf(step)
	local button = BUTTONS[string.lower(step.button or "left")]

	if not button then
		error("button must be left, right or middle")
	end

	return button
end

local total = 0

for _, step in ipairs(params.steps) do
	local kind = step.type or "click"

	if kind == "wait" then
		total += step.seconds or 0
	elseif kind == "drag" then
		total += (step.duration or 0.4) + 0.6
	else
		total += 0.6
	end
end

if total > MAX_SECONDS then
	error(string.format("these steps take about %.0fs; one call can run at most %ds, so split them up", total, MAX_SECONDS))
end

local lines = {}
local pressed = nil

local ran, problem = pcall(function()
	for index, step in ipairs(params.steps) do
		local kind = step.type or "click"

		if kind == "move" then
			local point = pointOf(step, "move")

			input:SendMousePosition(point)
			task.wait(0.1)
			table.insert(lines, string.format("moved to (%d, %d)", point.X, point.Y))
		elseif kind == "click" or kind == "double_click" then
			local point = pointOf(step, kind)
			local button = buttonOf(step)

			input:SendMousePosition(point - Vector2.new(24, 12))
			task.wait(0.1)
			input:SendMousePosition(point)
			task.wait(0.1)

			for _ = 1, if kind == "double_click" then 2 else 1 do
				input:SendMouseButton(point, button, true)
				task.wait(0.1)
				input:SendMouseButton(point, button, false)
				task.wait(0.1)
			end

			table.insert(lines, string.format("%s at (%d, %d)", kind, point.X, point.Y))
		elseif kind == "down" or kind == "up" then
			local point = pointOf(step, kind)
			local button = buttonOf(step)

			input:SendMousePosition(point)
			task.wait(0.05)
			input:SendMouseButton(point, button, kind == "down")
			pressed = if kind == "down" then {point = point, button = button} else nil
			table.insert(lines, string.format("button %s at (%d, %d)", kind, point.X, point.Y))
		elseif kind == "drag" then
			local from = pointOf({x = step.fromX, y = step.fromY}, "drag from")
			local to = pointOf({x = step.toX, y = step.toY}, "drag to")
			local button = buttonOf(step)
			local seconds = step.duration or 0.4
			local moves = math.max(4, math.floor(seconds / 0.05))

			input:SendMousePosition(from)
			task.wait(0.1)
			input:SendMouseButton(from, button, true)
			pressed = {point = from, button = button}

			for move = 1, moves do
				input:SendMousePosition(from:Lerp(to, move / moves))
				task.wait(seconds / moves)
			end

			input:SendMouseButton(to, button, false)
			pressed = nil
			table.insert(lines, string.format("dragged (%d, %d) to (%d, %d)", from.X, from.Y, to.X, to.Y))
		elseif kind == "delta" then
			input:SendMouseDelta(Vector2.new(step.dx or 0, step.dy or 0))
			task.wait(0.1)
			table.insert(lines, string.format("moved the mouse by (%g, %g)", step.dx or 0, step.dy or 0))
		elseif kind == "wait" then
			task.wait(step.seconds or 0)
			table.insert(lines, "waited " .. (step.seconds or 0) .. "s")
		else
			error("step " .. index .. ": type must be move, click, double_click, down, up, drag, delta or wait")
		end
	end
end)

if not ran then
	if pressed then
		pcall(function()
			input:SendMouseButton(pressed.point, pressed.button, false)
		end)
	end

	error(tostring(problem) .. " (a held button was released)")
end

if pressed then
	table.insert(lines, "button is still held down (release with a step of type up)")
end

return table.concat(lines, "\n")
