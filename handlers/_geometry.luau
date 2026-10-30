local function worldBounds(instance)
	local low = Vector3.new(math.huge, math.huge, math.huge)
	local high = Vector3.new(-math.huge, -math.huge, -math.huge)
	local found = false

	local function include(part)
		local cf = part.CFrame
		local size = part.Size
		local r, u, l = cf.RightVector, cf.UpVector, cf.LookVector
		local half = Vector3.new(
			(math.abs(r.X) * size.X + math.abs(u.X) * size.Y + math.abs(l.X) * size.Z) / 2,
			(math.abs(r.Y) * size.X + math.abs(u.Y) * size.Y + math.abs(l.Y) * size.Z) / 2,
			(math.abs(r.Z) * size.X + math.abs(u.Z) * size.Y + math.abs(l.Z) * size.Z) / 2
		)

		low = low:Min(cf.Position - half)
		high = high:Max(cf.Position + half)
		found = true
	end

	if instance:IsA("BasePart") then
		include(instance)
	end

	for _, descendant in ipairs(instance:GetDescendants()) do
		if descendant:IsA("BasePart") and not descendant:IsA("Terrain") then
			include(descendant)
		end
	end

	if not found then
		return nil
	end

	return low, high
end

local function formatVector(value)
	return string.format("(%.2f, %.2f, %.2f)", value.X, value.Y, value.Z)
end
