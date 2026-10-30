local root = if params.root then resolve(params.root) else game
local sampleSize = params.samples or 8

local sounds = {}

for _, descendant in ipairs(root:GetDescendants()) do
	if descendant:IsA("Sound") then
		table.insert(sounds, descendant)
	end
end

if #sounds == 0 then
	return "no Sound instances under " .. pathOf(root)
end

local missing = {}
local silent = {}
local loud = {}
local autoplay = {}
local byId = {}

for _, sound in ipairs(sounds) do
	if sound.SoundId == "" then
		table.insert(missing, sound)
	else
		byId[sound.SoundId] = byId[sound.SoundId] or {}
		table.insert(byId[sound.SoundId], sound)
	end

	if sound.Volume == 0 then
		table.insert(silent, sound)
	elseif sound.Volume > 5 then
		table.insert(loud, sound)
	end

	if sound.Playing then
		table.insert(autoplay, sound)
	end
end

local lines = {#sounds .. " sounds under " .. pathOf(root)}

local function section(label, list)
	if #list == 0 then
		return
	end

	table.insert(lines, #list .. " " .. label)

	for index = 1, math.min(#list, sampleSize) do
		table.insert(lines, "  " .. pathOf(list[index]))
	end
end

section("with no SoundId", missing)
section("with volume 0", silent)
section("with volume above 5", loud)
section("set to Playing", autoplay)

local repeated = {}

for id, list in pairs(byId) do
	if #list > 1 then
		table.insert(repeated, {id = id, list = list})
	end
end

table.sort(repeated, function(a, b)
	return #a.list > #b.list
end)

if #repeated > 0 then
	table.insert(lines, #repeated .. " SoundIds used more than once")

	for index = 1, math.min(#repeated, sampleSize) do
		table.insert(lines, "  " .. repeated[index].id .. " x" .. #repeated[index].list)
	end
end

return table.concat(lines, "\n")
