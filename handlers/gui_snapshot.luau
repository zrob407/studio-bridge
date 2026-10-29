local Players = game:GetService("Players")
local GuiService = game:GetService("GuiService")

local player = Players.LocalPlayer

if not player then
	error("gui_snapshot must run in the client window (pass studio \"client\")")
end

local playerGui = player:FindFirstChildOfClass("PlayerGui")
local root = if params.root then resolve(params.root) else playerGui
local limit = params.max_results or 200
local visibleOnly = params.visible_only ~= false
local inset = GuiService:GetGuiInset()

local function isShown(gui)
	local current = gui

	while current and current ~= playerGui do
		if current:IsA("GuiObject") and not current.Visible then
			return false
		end

		if current:IsA("LayerCollector") and not current.Enabled then
			return false
		end

		current = current.Parent
	end

	return true
end

local lines = {}
local total = 0

for _, gui in ipairs(root:GetDescendants()) do
	if gui:IsA("GuiObject") and (not visibleOnly or isShown(gui)) then
		total += 1

		if total <= limit then
			local label = ""

			if gui:IsA("TextLabel") or gui:IsA("TextButton") or gui:IsA("TextBox") then
				label = ' "' .. string.sub(gui.Text, 1, 60) .. '"'
			end

			local clickable = if gui:IsA("GuiButton") then " [button]" elseif gui:IsA("TextBox") then " [input]" else ""
			local center = gui.AbsolutePosition + gui.AbsoluteSize / 2 + inset

			table.insert(
				lines,
				string.format(
					"%s [%s]%s%s  center=(%d,%d) size=(%d,%d)",
					pathOf(gui),
					gui.ClassName,
					clickable,
					label,
					center.X,
					center.Y,
					gui.AbsoluteSize.X,
					gui.AbsoluteSize.Y
				)
			)
		end
	end
end

if total == 0 then
	return "no matching gui objects"
end

if total > limit then
	table.insert(lines, string.format("[%d objects, showing %d]", total, limit))
end

return table.concat(lines, "\n")
