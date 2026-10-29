local script = requireScript(params.path)
local lines = string.split(readSource(script), "\n")
local originalCount = #lines

if type(params.edits) ~= "table" or #params.edits == 0 then
	error("edits is required")
end

local plan = {}

for index, edit in ipairs(params.edits) do
	local op = edit.op or "replace"
	local from
	local count
	local replacement

	if op == "replace" then
		from = edit.start_line
		count = (edit.end_line or edit.start_line) - edit.start_line + 1
		replacement = string.split(edit.text or "", "\n")
	elseif op == "delete" then
		from = edit.start_line
		count = (edit.end_line or edit.start_line) - edit.start_line + 1
		replacement = {}
	elseif op == "insert" then
		from = (edit.after_line or 0) + 1
		count = 0
		replacement = string.split(edit.text or "", "\n")
	else
		error("edit " .. index .. ": unknown op " .. tostring(op))
	end

	if type(from) ~= "number" or from < 1 or count < 0 or from + count - 1 > originalCount or from > originalCount + 1 then
		error(string.format("edit %d: lines out of range (script has %d lines)", index, originalCount))
	end

	table.insert(plan, {from = from, count = count, replacement = replacement, index = index})
end

table.sort(plan, function(a, b)
	if a.from ~= b.from then
		return a.from < b.from
	end

	return a.index < b.index
end)

for position = 2, #plan do
	local previous = plan[position - 1]

	if previous.from + previous.count > plan[position].from then
		error(string.format("edits %d and %d overlap", previous.index, plan[position].index))
	end
end

for position = #plan, 1, -1 do
	local step = plan[position]

	for _ = 1, step.count do
		table.remove(lines, step.from)
	end

	for offset, line in ipairs(step.replacement) do
		table.insert(lines, step.from + offset - 1, line)
	end
end

local text = table.concat(lines, "\n")

writeSource(script, text)

local message = string.format("applied %d edit(s) to %s: %d -> %d lines", #plan, pathOf(script), originalCount, #lines)
local problem = syntaxError(text)

if problem then
	message ..= "\nsyntax error: " .. problem
end

return message
