local LogService = game:GetService("LogService")

local labels = {
	[Enum.MessageType.MessageOutput] = "output",
	[Enum.MessageType.MessageInfo] = "info",
	[Enum.MessageType.MessageWarning] = "warning",
	[Enum.MessageType.MessageError] = "error",
}

local wanted

if type(params.types) == "table" and #params.types > 0 then
	wanted = {}

	for _, name in ipairs(params.types) do
		wanted[string.lower(name)] = true
	end
end

local needle = if params.pattern then string.lower(params.pattern) else nil
local limit = params.count or 50
local picked = {}

for _, entry in ipairs(LogService:GetLogHistory()) do
	local label = labels[entry.messageType] or "output"
	local keep = (wanted == nil or wanted[label]) and (needle == nil or string.find(string.lower(entry.message), needle, 1, true) ~= nil)

	if keep then
		table.insert(picked, string.format("[%s] [%s] %s", os.date("%H:%M:%S", entry.timestamp), label, entry.message))
	end
end

if #picked == 0 then
	return "no log lines"
end

local first = math.max(1, #picked - limit + 1)
local out = {}

if first > 1 then
	table.insert(out, string.format("[%d earlier lines not shown]", first - 1))
end

for index = first, #picked do
	table.insert(out, picked[index])
end

return table.concat(out, "\n")
