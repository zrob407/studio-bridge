local root = if params.root then resolve(params.root) else game
local includeWeak = params.include_weak == true
local MAX_RECORDS = 300000
local YIELD_EVERY = 2500
local MAX_SOURCE = 800000

local started = os.clock()
local records = {}
local seen = {}
local counts = {instances = 0, properties = 0, scripts = 0, strong = 0, weak = 0, skippedSources = 0}
local classProps = {}

local function add(id, kind, instance, detail)
	if #records >= MAX_RECORDS then
		return
	end

	local path = pathOf(instance)
	local key = id .. "|" .. path .. "|" .. detail

	if seen[key] then
		return
	end

	seen[key] = true
	table.insert(records, {id = id, kind = kind, path = path, detail = detail})

	if kind == "script-weak" then
		counts.weak += 1
	else
		counts.strong += 1
	end
end

local function strongIds(text)
	local ids = {}

	for id in string.gmatch(text, "rbxassetid://(%d+)") do
		ids[id] = true
	end

	for id in string.gmatch(string.lower(text), "[?&]id=(%d+)") do
		ids[id] = true
	end

	for id in string.gmatch(string.lower(text), "/asset/(%d+)") do
		ids[id] = true
	end

	local trimmed = string.match(text, "^%s*(%d+)%s*$")

	if trimmed and #trimmed >= 5 then
		ids[trimmed] = true
	end

	return ids
end

local function contentProperties(className)
	local cached = classProps[className]

	if cached then
		return cached
	end

	local names = {}
	local ok, listed = pcall(function()
		return ReflectionService:GetPropertiesOfClass(className)
	end)

	if ok and type(listed) == "table" then
		for _, entry in ipairs(listed) do
			if entry.ContentType ~= nil and entry.Serialized then
				table.insert(names, entry.Name)
			end
		end
	end

	classProps[className] = names

	return names
end

local descendants = root:GetDescendants()

table.insert(descendants, 1, root)

for index, instance in ipairs(descendants) do
	counts.instances += 1

	for _, name in ipairs(contentProperties(instance.ClassName)) do
		local ok, value = pcall(function()
			return instance[name]
		end)

		if ok then
			counts.properties += 1

			local text = value

			if typeof(value) == "Content" then
				text = value.Uri
			end

			if type(text) == "string" and text ~= "" then
				for id in pairs(strongIds(text)) do
					add(id, "property", instance, name)
				end
			end
		end
	end

	if instance:IsA("StringValue") then
		for id in pairs(strongIds(instance.Value)) do
			add(id, "stringvalue", instance, "Value")
		end
	end

	for name, value in pairs(instance:GetAttributes()) do
		if type(value) == "string" then
			for id in pairs(strongIds(value)) do
				add(id, "attribute", instance, name)
			end
		end
	end

	if instance:IsA("LuaSourceContainer") then
		local ok, source = pcall(function()
			return instance.Source
		end)

		if ok and type(source) == "string" then
			if #source > MAX_SOURCE then
				counts.skippedSources += 1
			else
				counts.scripts += 1

				local found = {}

				for id in string.gmatch(source, "rbxassetid://(%d+)") do
					found[id] = true
				end

				for id in string.gmatch(string.lower(source), "[?&]id=(%d+)") do
					found[id] = true
				end

				for id in string.gmatch(string.lower(source), "/asset/(%d+)") do
					found[id] = true
				end

				for id in pairs(found) do
					add(id, "script", instance, "Source")
				end

				if includeWeak then
					for number in string.gmatch(source, "%f[%d](%d%d%d%d%d%d%d%d%d*)%f[%D]") do
						if #number <= 19 and not found[number] then
							add(number, "script-weak", instance, "Source")
						end
					end
				end
			end
		end
	end

	if index % YIELD_EVERY == 0 then
		task.wait()
	end
end

local uniqueStrong = {}
local uniqueWeak = {}

for _, record in ipairs(records) do
	if record.kind == "script-weak" then
		uniqueWeak[record.id] = true
	else
		uniqueStrong[record.id] = true
	end
end

local function size(set)
	local total = 0

	for _ in pairs(set) do
		total += 1
	end

	return total
end

bridge.attachFile("asset-scan.json", HttpService:JSONEncode({root = pathOf(root), placeName = game.Name, placeId = game.PlaceId, records = records}))

return string.format(
	"scanned %d instances (%d content properties, %d scripts%s) in %.1fs: %d references, %d unique asset ids%s",
	counts.instances,
	counts.properties,
	counts.scripts,
	if counts.skippedSources > 0 then ", " .. counts.skippedSources .. " oversized scripts skipped" else "",
	os.clock() - started,
	#records,
	size(uniqueStrong),
	if includeWeak then string.format(" (+%d possible ids found only as bare numbers in scripts)", size(uniqueWeak)) else ""
)
