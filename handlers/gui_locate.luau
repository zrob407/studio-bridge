local Players = game:GetService("Players")
local GuiService = game:GetService("GuiService")

if not Players.LocalPlayer then
	error("gui_locate must run in the client window")
end

local gui = resolve(params.path)

if not gui:IsA("GuiObject") then
	error(pathOf(gui) .. " is not a gui object")
end

local current = gui

while current and current ~= game do
	if current:IsA("GuiObject") and not current.Visible then
		error(pathOf(gui) .. " is not visible (" .. pathOf(current) .. " is hidden)")
	end

	if current:IsA("LayerCollector") and not current.Enabled then
		error(pathOf(gui) .. " is not visible (" .. pathOf(current) .. " is disabled)")
	end

	current = current.Parent
end

local center = gui.AbsolutePosition + gui.AbsoluteSize / 2 + GuiService:GetGuiInset()

return HttpService:JSONEncode({x = center.X, y = center.Y})
