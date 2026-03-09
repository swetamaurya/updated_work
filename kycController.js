
export const processedToBank = async (req, res) => {
    try {
        const { customerId, isSubmit, brePulled, breStatus, bsaBrePulled, bsaBreStatus, bsaInitiated, bsaStatus, applicationNumber, breApproved = false, breRejectPullAfter } = req.body;

        if (!customerId) {
            return res.status(400).json({
                success: false,
                message: "customerId is required"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(customerId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid customerId"
            });
        }

        const customerExists = await CustomerModel.findById(customerId).select("_id");

        if (!customerExists) {
            return res.status(404).json({
                success: false,
                message: "Customer not found"
            });
        }

        const customerUpdateData = {};
        const applicationUpdateData = {};

        if (typeof isSubmit === "boolean") {
            customerUpdateData.isSubmit = isSubmit;
            applicationUpdateData.isSubmit = isSubmit;
        }

        if (breRejectPullAfter !== undefined)
            customerUpdateData.breRejectPullAfter = breRejectPullAfter;

        if (brePulled !== undefined)
            applicationUpdateData["breHistory.brePulled"] = brePulled;

        if (breStatus !== undefined)
            applicationUpdateData["breHistory.breStatus"] = breStatus;

        if (bsaBrePulled !== undefined)
            applicationUpdateData["breHistory.bsaBrePulled"] = bsaBrePulled;

        if (bsaBreStatus !== undefined)
            applicationUpdateData["breHistory.bsaBreStatus"] = bsaBreStatus;

        if (bsaInitiated !== undefined)
            applicationUpdateData["breHistory.bsaInitiated"] = bsaInitiated;

        if (bsaStatus !== undefined)
            applicationUpdateData["breHistory.bsaStatus"] = bsaStatus;

        // 🔹 Perform updates only if data exists
        const updatePromises = [];

        if (Object.keys(customerUpdateData).length > 0) {
            updatePromises.push(
                CustomerModel.findByIdAndUpdate(
                    customerId,
                    { $set: customerUpdateData },
                    { new: true }
                )
            );
        }

        if (Object.keys(applicationUpdateData).length > 0) {
            updatePromises.push(
                ApplicationModel.findOneAndUpdate(
                    { customerId },
                    { $set: applicationUpdateData },
                    { new: true }
                )
            );
        }

        const results = await Promise.all(updatePromises);

        let updatedCustomer = null;
        let updatedApplication = null;

        if (Object.keys(customerUpdateData).length > 0 && Object.keys(applicationUpdateData).length > 0) {
            updatedCustomer = results[0];
            updatedApplication = results[1];
        } else if (Object.keys(customerUpdateData).length > 0) {
            updatedCustomer = results[0];
        } else if (Object.keys(applicationUpdateData).length > 0) {
            updatedApplication = results[0];
        }

        if (breApproved) {
            updatedApplication = await ApplicationModel.findOneAndUpdate(
                { applicationNumber: applicationNumber },
                {
                    $set: {
                        "breHistory.breStatus": "APPROVED",
                        "externalApiResponse.bsaTobre.response.output_data.rules_output.final_decision.LoanAmount": 10000,
                        "externalApiResponse.bsaTobre.response.output_data.rules_output.final_decision.Decision": "Approve"
                    }
                },
                { new: true }
            );
        }

        return res.status(200).json({
            success: true,
            message: "Customer successfully processed to bank",
            data: {
                customerId,
                isSubmit: updatedCustomer?.isSubmit,
                breHistory: updatedApplication?.breHistory || null
            }
        });

    } catch (error) {
        console.error("processedToBank error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};