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
