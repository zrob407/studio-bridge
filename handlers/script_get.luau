-- An example handler. A handler is the body of a function:
--   * params is the table of tool arguments (the input schema for this tool is in tools.json under the same name).
--   * Whatever it returns becomes the tool result. Strings are returned as text, tables as printed tables.
--   * It can use anything from _prelude.luau, and print() output is returned with the result.
--   * Errors are reported to the AI client with a traceback, so use error("clear message") to reject bad arguments.

local script = requireScript(params.path)
local lines = string.split(readSource(script), "\n")
local first = math.max(1, params.start_line or 1)
local last = math.min(#lines, params.end_line or #lines)
local numbered = params.numbered ~= false

local out = {string.format("%s [%s] %d lines", pathOf(script), script.ClassName, #lines)}

for index = first, last do
	table.insert(out, if numbered then index .. "\t" .. lines[index] else lines[index])
end

return table.concat(out, "\n")
