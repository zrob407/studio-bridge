local Players = game:GetService("Players")
local GuiService = game:GetService("GuiService")

local player = Players.LocalPlayer

if not player then
	error("ui_check must run in the player client of a play session")
end

local playerGui = player:FindFirstChildOfClass("PlayerGui")
local root = if params.root then resolve(params.root) else playerGui
local viewport = workspace.CurrentCamera.ViewportSize
local inset = GuiService:GetGuiInset()
local minText = params.min_text_size or 12
local minTouch = params.min_touch_size or 40
local limit = params.max_findings or 100
local MAX_OVERLAP_ELEMENTS = 300

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

local function screenOffset(gui)
	local layer = gui:FindFirstAncestorWhichIsA("ScreenGui")

	if layer and layer.IgnoreGuiInset then
		return Vector2.zero
	end

	return inset
end

local function isClipped(gui)
	local current = gui.Parent

	while current and not current:IsA("LayerCollector") do
		if current:IsA("ScrollingFrame") or (current:IsA("GuiObject") and current.ClipsDescendants) then
			return true
		end

		current = current.Parent
	end

	return false
end

local function luminance(color)
	local function channel(value)
		return if value <= 0.03928 then value / 12.92 else ((value + 0.055) / 1.055) ^ 2.4
	end

	return 0.2126 * channel(color.R) + 0.7152 * channel(color.G) + 0.0722 * channel(color.B)
end

local function contrast(first, second)
	local a = luminance(first)
	local b = luminance(second)

	return (math.max(a, b) + 0.05) / (math.min(a, b) + 0.05)
end

local function backgroundOf(gui)
	local current = gui

	while current and not current:IsA("LayerCollector") do
		if current:IsA("GuiObject") and current.BackgroundTransparency < 0.5 then
			return current.BackgroundColor3
		end

		current = current.Parent
	end

	return nil
end

local findings = {}
local counts = {error = 0, warning = 0}

local function report(severity, gui, message)
	counts[severity] += 1

	if #findings < limit then
		table.insert(findings, string.format("[%s] %s: %s", severity, pathOf(gui), message))
	end
end

local elements = {}
local checked = 0

for _, gui in ipairs(root:GetDescendants()) do
	if gui:IsA("GuiObject") and isShown(gui) then
		checked += 1

		local size = gui.AbsoluteSize
		local topLeft = gui.AbsolutePosition + screenOffset(gui)
		local bottomRight = topLeft + size
		local isText = gui:IsA("TextLabel") or gui:IsA("TextButton") or gui:IsA("TextBox")
		local hasText = isText and gui.Text ~= ""
		local visibleBackground = gui.BackgroundTransparency < 1

		if (hasText or visibleBackground or gui:IsA("ImageLabel") or gui:IsA("ImageButton")) and (size.X <= 0 or size.Y <= 0) then
			report("warning", gui, "has zero size, so nothing is drawn")
		elseif size.X > 0 and size.Y > 0 and not isClipped(gui) then
			if bottomRight.X <= 0 or bottomRight.Y <= 0 or topLeft.X >= viewport.X or topLeft.Y >= viewport.Y then
				report("error", gui, "is completely off-screen")
			else
				local over = math.max(-topLeft.X, -topLeft.Y, bottomRight.X - viewport.X, bottomRight.Y - viewport.Y)

				if over > 8 then
					report("warning", gui, string.format("extends %d px beyond the screen edge", over))
				end
			end
		end

		if hasText then
			if not gui.TextScaled and gui.TextSize < minText then
				report("warning", gui, string.format("text size %d is below %d", gui.TextSize, minText))
			end

			if not gui.TextFits then
				report("warning", gui, "text does not fit inside the element")
			end

			local background = backgroundOf(gui)

			if background then
				local ratio = contrast(gui.TextColor3, background)
				local needed = if gui.TextSize >= 18 then 3 else 4.5

				if ratio < needed then
					report("warning", gui, string.format("low text contrast %.1f:1 (wants %.1f:1)", ratio, needed))
				end
			end
		end

		if gui:IsA("GuiButton") and size.X > 0 and size.Y > 0 and math.min(size.X, size.Y) < minTouch then
			report("warning", gui, string.format("small touch target %dx%d (under %d px)", size.X, size.Y, minTouch))
		end

		if (gui:IsA("GuiButton") or hasText) and size.X > 0 and size.Y > 0 and #elements < MAX_OVERLAP_ELEMENTS then
			table.insert(elements, {gui = gui, min = topLeft, max = bottomRight})
		end
	end
end

for first = 1, #elements do
	for second = first + 1, #elements do
		local a = elements[first]
		local b = elements[second]

		if not a.gui:IsDescendantOf(b.gui) and not b.gui:IsDescendantOf(a.gui) then
			local width = math.min(a.max.X, b.max.X) - math.max(a.min.X, b.min.X)
			local height = math.min(a.max.Y, b.max.Y) - math.max(a.min.Y, b.min.Y)

			if width > 0 and height > 0 then
				local smaller = math.min((a.max.X - a.min.X) * (a.max.Y - a.min.Y), (b.max.X - b.min.X) * (b.max.Y - b.min.Y))

				if width * height > smaller * 0.4 then
					report("warning", a.gui, "overlaps " .. pathOf(b.gui))
				end
			end
		end
	end
end

local lines = {string.format("checked %d visible gui objects at %dx%d: %d error(s), %d warning(s)", checked, viewport.X, viewport.Y, counts.error, counts.warning)}

for _, finding in ipairs(findings) do
	table.insert(lines, finding)
end

if counts.error + counts.warning > #findings then
	table.insert(lines, string.format("[showing %d of %d findings]", #findings, counts.error + counts.warning))
end

return table.concat(lines, "\n")
