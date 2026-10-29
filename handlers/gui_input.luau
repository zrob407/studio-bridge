local UserInputService = game:GetService("UserInputService")

if type(params.x) ~= "number" or type(params.y) ~= "number" then
	error("x and y are required")
end

local viewport = workspace.CurrentCamera.ViewportSize
local point = Vector2.new(params.x, params.y)

if point.X < 0 or point.Y < 0 or point.X >= viewport.X or point.Y >= viewport.Y then
	error(string.format("(%d, %d) is outside the %dx%d viewport", point.X, point.Y, viewport.X, viewport.Y))
end

local input = UserInputService:CreateVirtualInput()
local buttonType = if params.button == "right" then Enum.UserInputType.MouseButton2 else Enum.UserInputType.MouseButton1

input:SendMousePosition(point - Vector2.new(24, 12))
task.wait(0.15)
input:SendMousePosition(point)
task.wait(0.15)
input:SendMouseButton(point, buttonType, true)
task.wait(0.15)
input:SendMouseButton(point, buttonType, false)
task.wait(0.3)

return string.format("clicked (%d, %d)", point.X, point.Y)
