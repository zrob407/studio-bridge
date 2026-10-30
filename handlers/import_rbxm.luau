local SerializationService = game:GetService("SerializationService")

local ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local lookup = {}

for index = 1, #ALPHABET do
	lookup[string.byte(ALPHABET, index)] = index - 1
end

local function decodeBase64(text)
	local clean = string.gsub(text, "[^%w%+/]", "")
	local size = math.floor(#clean * 3 / 4)
	local out = buffer.create(size)
	local position = 0

	for index = 1, #clean, 4 do
		local a, b, c, d = string.byte(clean, index, index + 3)
		local value = lookup[a] * 262144 + lookup[b] * 4096 + (if c then lookup[c] else 0) * 64 + (if d then lookup[d] else 0)

		if position < size then
			buffer.writeu8(out, position, bit32.band(bit32.rshift(value, 16), 255))
			position += 1
		end

		if c and position < size then
			buffer.writeu8(out, position, bit32.band(bit32.rshift(value, 8), 255))
			position += 1
		end

		if d and position < size then
			buffer.writeu8(out, position, bit32.band(value, 255))
			position += 1
		end
	end

	return out
end

if type(params.base64) ~= "string" or params.base64 == "" then
	error("no file data")
end

local parent = if params.scan_only then nil else resolve(params.parent)
local container = Instance.new("Folder")
container.Name = "__ImportStaging"
container.Parent = game:GetService("ServerStorage")

local ok, imported = pcall(function()
	return SerializationService:DeserializeInstancesAsync(decodeBase64(params.base64))
end)

if not ok then
	container:Destroy()
	error("could not read the file: " .. tostring(imported))
end

for _, instance in ipairs(imported) do
	instance.Parent = container
end

local report, counts = scanScripts(container, params.max_findings or 100)
local names = {}

for _, instance in ipairs(imported) do
	table.insert(names, instance.Name .. " (" .. instance.ClassName .. ")")
end

if params.scan_only then
	container:Destroy()

	return string.format("file holds %d top-level instance(s): %s\n%s", #imported, table.concat(names, ", "), report)
end

if params.block_high ~= false and counts.high > 0 then
	container:Destroy()

	return string.format("NOT imported (high-risk code found; rerun with block_high false to force). Instances: %s\n%s", table.concat(names, ", "), report)
end

for _, instance in ipairs(imported) do
	instance.Parent = parent
end

container:Destroy()

return string.format("imported %d instance(s) into %s: %s\n%s", #imported, pathOf(parent), table.concat(names, ", "), report)
