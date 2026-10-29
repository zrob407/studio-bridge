if type(params.source) ~= "string" then
	error("source is required")
end

local script = requireScript(params.path)

writeSource(script, params.source)

local message = string.format("wrote %d lines to %s", #string.split(params.source, "\n"), pathOf(script))
local problem = syntaxError(params.source)

if problem then
	message ..= "\nsyntax error: " .. problem
end

return message
