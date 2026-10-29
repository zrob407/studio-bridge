local CaptureService = game:GetService("CaptureService")
local AssetService = game:GetService("AssetService")

local TILE = 1024
local maxWidth = params.max_width or 1000

local uri

CaptureService:CaptureScreenshot(function(contentId)
	uri = contentId
end)

local started = os.clock()

while uri == nil and os.clock() - started < 10 do
	task.wait(0.1)
end

if uri == nil then
	error("screenshot timed out; make sure the Studio viewport is visible and not minimized")
end

local image = AssetService:CreateEditableImageAsync(Content.fromUri(uri))
local width = math.floor(image.Size.X)
local height = math.floor(image.Size.Y)

if maxWidth > 0 and width > maxWidth then
	local newHeight = math.max(1, math.floor(height * maxWidth / width))
	local resized = pcall(function()
		image:Resize(Vector2.new(maxWidth, newHeight))
	end)

	if resized then
		width = maxWidth
		height = newHeight
	end
end

local pixels = buffer.create(width * height * 4)
local rowBytes = width * 4
local top = 0

while top < height do
	local tileHeight = math.min(TILE, height - top)
	local left = 0

	while left < width do
		local tileWidth = math.min(TILE, width - left)
		local tile = image:ReadPixelsBuffer(Vector2.new(left, top), Vector2.new(tileWidth, tileHeight))
		local tileRow = tileWidth * 4

		for row = 0, tileHeight - 1 do
			buffer.copy(pixels, (top + row) * rowBytes + left * 4, tile, row * tileRow, tileRow)
		end

		left += TILE
	end

	top += TILE
end

image:Destroy()

bridge.attachFile(string.format("viewport-%dx%d.rgba", width, height), pixels)

return string.format("captured %dx%d", width, height)
