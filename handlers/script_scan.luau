local root = if params.root then resolve(params.root) else game

return scanScripts(root, params.max_findings or 100)
