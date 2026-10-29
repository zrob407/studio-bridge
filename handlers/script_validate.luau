local source = params.source

if source == nil then
	source = readSource(requireScript(params.path))
end

local problem = syntaxError(source)

return if problem then "syntax error: " .. problem else "ok"
