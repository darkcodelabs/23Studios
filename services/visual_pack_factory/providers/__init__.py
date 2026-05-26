"""Candidate generation providers.

A provider takes a structured prompt + references + count and returns N
candidate PNGs that the factory ingests as `status=generated`. Provider
output never auto-finalizes; the review pipeline remains authoritative.
"""
