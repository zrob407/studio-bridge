local root = resolve(params.path)
local dryRun = params.dryRun == true
local doPosition = params.position ~= false
local doSize = params.size ~= false
local doLayouts = params.layouts ~= false
local doCorners = params.corners ~= false
local textMode = params.text or "constrain"
local aspectMode = params.aspect or "auto"
local minText = params.minTextSize or 8
local limitSize = params.limitSize ~= false
local designSize = nil

if params.designSize then
	if type(params.designSize) ~= "table" or type(params.designSize[1]) ~= "number" or type(params.designSize[2]) ~= "number" then
		error("designSize must be [width, height]")
	end

	designSize = Vector2.new(params.designSize[1], params.designSize[2])
end
local LAYOUT_CLASSES = {"UIListLayout", "UIGridLayout", "UIPageLayout", "UITableLayout"}
local SAMPLE_LIMIT = 12

if not root:IsA("GuiBase2d") then
	error(pathOf(root) .. " is not a GUI object or container")
end

if textMode ~= "constrain" and textMode ~= "none" then
	error("text must be constrain or none")
end

if aspectMode ~= "auto" and aspectMode ~= "all" and aspectMode ~= "none" then
	error("aspect must be auto, all or none")
end

local function round(value)
	return math.round(value * 100000) / 100000
end

local function describeUDim2(value)
	return string.format("{%.4f, %d}, {%.4f, %d}", value.X.Scale, value.X.Offset, value.Y.Scale, value.Y.Offset)
end

local function layoutOf(parent)
	for _, className in ipairs(LAYOUT_CLASSES) do
		local found = parent:FindFirstChildOfClass(className)

		if found then
			return found
		end
	end

	return nil
end

local parentCache = {}

local function measureParent(parent)
	local cached = parentCache[parent]

	if cached then
		return cached
	end

	local size = if designSize and parent:IsA("ScreenGui") then designSize else parent.AbsoluteSize
	local left, top, right, bottom = 0, 0, 0, 0
	local padding = parent:FindFirstChildOfClass("UIPadding")

	if padding then
		left = padding.PaddingLeft.Scale * size.X + padding.PaddingLeft.Offset
		top = padding.PaddingTop.Scale * size.Y + padding.PaddingTop.Offset
		right = padding.PaddingRight.Scale * size.X + padding.PaddingRight.Offset
		bottom = padding.PaddingBottom.Scale * size.Y + padding.PaddingBottom.Offset
	end

	cached = {
		basis = Vector2.new(size.X - left - right, size.Y - top - bottom),
		origin = parent.AbsolutePosition + Vector2.new(left, top),
		scrolling = parent:IsA("ScrollingFrame"),
		layout = layoutOf(parent),
	}
	parentCache[parent] = cached

	return cached
end

local items = {}

if root:IsA("GuiObject") then
	table.insert(items, root)
end

for _, descendant in ipairs(root:GetDescendants()) do
	if descendant:IsA("GuiObject") then
		table.insert(items, descendant)
	end
end

local snapshot = {}

for _, item in ipairs(items) do
	local parent = item.Parent

	snapshot[item] = {
		size = item.AbsoluteSize,
		position = item.AbsolutePosition,
		parent = if parent and parent:IsA("GuiBase2d") then measureParent(parent) else nil,
	}
end

local topLevel = {}

if root:IsA("ScreenGui") then
	for _, child in ipairs(root:GetChildren()) do
		if child:IsA("GuiObject") then
			topLevel[child] = true
		end
	end
elseif root.Parent and root.Parent:IsA("ScreenGui") then
	topLevel[root] = true
end

local counts = {size = 0, position = 0, corner = 0, layout = 0, text = 0, aspect = 0, limit = 0}
local skipped = {unmeasurable = 0, scrolling = 0, automatic = 0, gridSized = 0, layoutPlaced = 0}
local samples = {}

local function note(line)
	if #samples < SAMPLE_LIMIT then
		table.insert(samples, line)
	end
end

local function relativeBasis(item, basis)
	if item.SizeConstraint == Enum.SizeConstraint.RelativeXX then
		return Vector2.new(basis.X, basis.X)
	elseif item.SizeConstraint == Enum.SizeConstraint.RelativeYY then
		return Vector2.new(basis.Y, basis.Y)
	end

	return basis
end

for _, item in ipairs(items) do
	local info = snapshot[item]
	local parent = info.parent

	if parent then
		local measurable = parent.basis.X > 0 and parent.basis.Y > 0
		local before = item.Size

		if doSize and (before.X.Offset ~= 0 or before.Y.Offset ~= 0) then
			if not measurable then
				skipped.unmeasurable += 1
			elseif parent.scrolling then
				skipped.scrolling += 1
			elseif item.AutomaticSize ~= Enum.AutomaticSize.None then
				skipped.automatic += 1
			elseif parent.layout and parent.layout:IsA("UIGridLayout") then
				skipped.gridSized += 1
			else
				local relative = relativeBasis(item, parent.basis)
				local after = UDim2.new(round(info.size.X / relative.X), 0, round(info.size.Y / relative.Y), 0)

				counts.size += 1
				note(pathOf(item) .. " size " .. describeUDim2(before) .. " -> " .. describeUDim2(after))

				if not dryRun then
					item.Size = after
				end
			end
		end

		local placed = item.Position

		if doPosition and (placed.X.Offset ~= 0 or placed.Y.Offset ~= 0) then
			if not measurable then
				skipped.unmeasurable += 1
			elseif parent.scrolling then
				skipped.scrolling += 1
			elseif parent.layout then
				skipped.layoutPlaced += 1
			else
				local anchor = item.AnchorPoint
				local offset = info.position - parent.origin + Vector2.new(anchor.X * info.size.X, anchor.Y * info.size.Y)
				local after = UDim2.new(round(offset.X / parent.basis.X), 0, round(offset.Y / parent.basis.Y), 0)

				counts.position += 1
				note(pathOf(item) .. " position " .. describeUDim2(placed) .. " -> " .. describeUDim2(after))

				if not dryRun then
					item.Position = after
				end
			end
		end
	end

	local shortSide = math.min(info.size.X, info.size.Y)

	if doCorners and shortSide > 0 then
		local corner = item:FindFirstChildOfClass("UICorner")

		if corner and corner.CornerRadius.Offset ~= 0 then
			counts.corner += 1

			if not dryRun then
				corner.CornerRadius = UDim.new(round(math.clamp(corner.CornerRadius.Offset / shortSide, 0, 0.5)), 0)
			end
		end
	end

	if textMode == "constrain" and (item:IsA("TextLabel") or item:IsA("TextButton") or item:IsA("TextBox")) and not item:FindFirstChildOfClass("UITextSizeConstraint") then
		local biggest = if item.TextScaled then math.max(minText, math.floor(math.min(item.TextBounds.Y, info.size.Y) + 0.5)) else item.TextSize

		counts.text += 1

		if not dryRun then
			local constraint = Instance.new("UITextSizeConstraint")
			constraint.MaxTextSize = math.clamp(biggest, 1, 100)
			constraint.MinTextSize = math.min(minText, constraint.MaxTextSize)
			constraint.Parent = item
			item.TextScaled = true
		end
	end

	if topLevel[item] and aspectMode ~= "none" and not item:FindFirstChildOfClass("UIAspectRatioConstraint") and info.size.X > 0 and info.size.Y > 0 and info.parent then
		local share = Vector2.new(info.size.X / info.parent.basis.X, info.size.Y / info.parent.basis.Y)

		if aspectMode == "all" or (share.X < 0.9 and share.Y < 0.9) then
			counts.aspect += 1

			if not dryRun then
				local constraint = Instance.new("UIAspectRatioConstraint")
				constraint.AspectRatio = info.size.X / info.size.Y
				constraint.Parent = item
			end
		end
	end

	if topLevel[item] and limitSize and not item:FindFirstChildOfClass("UISizeConstraint") and info.size.X > 0 and info.size.Y > 0 then
		counts.limit += 1

		if not dryRun then
			local constraint = Instance.new("UISizeConstraint")
			constraint.MaxSize = info.size
			constraint.Parent = item
		end
	end

	if doLayouts then
		local list = item:FindFirstChildOfClass("UIListLayout")
		local grid = item:FindFirstChildOfClass("UIGridLayout")
		local frameSize = info.size

		if list and list.Padding.Offset ~= 0 and frameSize.X > 0 and frameSize.Y > 0 then
			local along = if list.FillDirection == Enum.FillDirection.Vertical then frameSize.Y else frameSize.X

			counts.layout += 1

			if not dryRun then
				list.Padding = UDim.new(round(list.Padding.Offset / along), 0)
			end
		end

		if grid and frameSize.X > 0 and frameSize.Y > 0 then
			local size = grid.CellSize
			local gap = grid.CellPadding

			if size.X.Offset ~= 0 or size.Y.Offset ~= 0 or gap.X.Offset ~= 0 or gap.Y.Offset ~= 0 then
				counts.layout += 1

				if not dryRun then
					grid.CellSize = UDim2.new(round(size.X.Scale + size.X.Offset / frameSize.X), 0, round(size.Y.Scale + size.Y.Offset / frameSize.Y), 0)
					grid.CellPadding = UDim2.new(round(gap.X.Scale + gap.X.Offset / frameSize.X), 0, round(gap.Y.Scale + gap.Y.Offset / frameSize.Y), 0)
				end
			end
		end
	end
end

local lines = {
	string.format(
		"%s%s: %d sizes, %d positions, %d corner radii, %d layout values, %d text constraints, %d aspect constraints, %d size limits",
		if dryRun then "dry run, nothing changed. " else "",
		pathOf(root),
		counts.size,
		counts.position,
		counts.corner,
		counts.layout,
		counts.text,
		counts.aspect,
		counts.limit
	),
}

local skippedParts = {}

for _, entry in ipairs({
	{"children of scrolling frames", skipped.scrolling},
	{"positions set by a layout", skipped.layoutPlaced},
	{"automatic-size items", skipped.automatic},
	{"sizes set by a grid layout", skipped.gridSized},
	{"items whose parent has no measurable size (is the ScreenGui enabled and in view?)", skipped.unmeasurable},
}) do
	if entry[2] > 0 then
		table.insert(skippedParts, entry[2] .. " " .. entry[1])
	end
end

if #skippedParts > 0 then
	table.insert(lines, "left alone: " .. table.concat(skippedParts, ", "))
end

for _, line in ipairs(samples) do
	table.insert(lines, "  " .. line)
end

if counts.size + counts.position > #samples then
	table.insert(lines, "  ... and " .. (counts.size + counts.position - #samples) .. " more size and position changes")
end

return table.concat(lines, "\n")
